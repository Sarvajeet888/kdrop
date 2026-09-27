#!/usr/bin/env node
/**
 * The specification must describe the implementation.
 *
 * A protocol document that drifts from the code is worse than no document:
 * it is confidently wrong, and someone will build against it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

const spec = read('protocol/SPEC.md');
const server = read('server.js');
const core = read('public/assets/core.js');

console.log('\nProtocol specification\n');

/* ---- every message the server handles must be documented ---- */
const handled = [...server.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);
const undocumented = [...new Set(handled)].filter((t) => !spec.includes(`"${t}"`) && !spec.includes(`\`${t}\``));
check('every server message type is in the spec',
  undocumented.length === 0, undocumented.join(', ') || `${handled.length} types`);

/* ---- and every peer-to-peer message ---- */
const peerMsgs = ['batch', 'batch-ok', 'batch-no', 'fstart', 'fend', 'bdone', 'cancel', 'note',
                  'resume-ask', 'resume-at', 'fresume', 'file-progress', 'file-ack', 'batch-ack', 'transfer-error'];
const appJs = read('public/assets/app.js');
for (const m of peerMsgs) {
  const inCode = core.includes(`'${m}'`) || appJs.includes(`'${m}'`);
  const inSpec = spec.includes(`"${m}"`) || spec.includes('`' + m + '`');
  check(`${m} is in both the code and the spec`, inCode && inSpec,
    inCode ? (inSpec ? '' : 'implemented but undocumented') : 'documented but not implemented');
}

/* ---- the constants are load-bearing; a wrong one silently breaks interop -- */
const constants = [
  ['PBKDF2 iterations', /iterations:\s*150_?000/, '150000', core],
  ['auth salt', /'k-drop\.auth\.v1'/, 'k-drop.auth.v1', core],
  ['session salt', /'k-drop\.session\.v1'/, 'k-drop.session.v1', core],
  ['ECDH curve', /namedCurve:\s*'P-256'/, 'P-256', core],
  ['direct frame size', /DC_CHUNK = 64 \* 1024/, '64 KB', core],
  ['relay frame size', /WS_CHUNK = 256 \* 1024/, '256 KB', core],
  ['buffer ceiling', /HIGH_WATER = 4 \* 1024 \* 1024/, '4 MB', core],
  ['fallback timeout', /}, 9000\)/, '9 seconds', core],
];
for (const [label, re, shown, src] of constants) {
  const inCode = re.test(src);
  const inSpec = spec.includes(shown);
  check(`${label} matches the spec`, inCode && inSpec,
    inCode ? (inSpec ? shown : `code says ${shown}, spec does not`) : `not found in code`);
}

/* ---- code alphabet and length ---- */
const alpha = (server.match(/const ALPHABET = '([^']+)'/) || [])[1] || '';
check('the code alphabet matches the spec', spec.includes(alpha), `${alpha.length} symbols`);
check('excluded characters are as documented',
  !/[01OIL]/.test(alpha) && /`0`, `1`, `O`, `I` and `L` removed/.test(spec));

/* ---- limits table ---- */
const limits = [
  ['MAX_SOCKETS_PER_IP', 16], ['MAX_ROOMS_PER_IP', 30], ['MAX_ROOMS_TOTAL', 5000],
  ['MAX_MSGS_PER_10S', 200], ['MAX_JOIN_FAILS', 20],
];
for (const [name, value] of limits) {
  const m = server.match(new RegExp(`${name} = Number\\(process\\.env\\.${name} \\|\\| ([\\d_]+)\\)`));
  const actual = m ? Number(m[1].replace(/_/g, '')) : null;
  check(`${name} default matches the spec`, actual === value,
    actual === null ? 'not found' : `code ${actual}, spec ${value}`);
}

/* ---- claims the spec makes about behaviour ---- */
check('the spec claim about receiver authority holds',
  /resume-ask/.test(core) && /resume-at/.test(core) && /m\.from !== this\.current\.got/.test(core),
  'the receiver reports, and a disagreement restarts the file');
check('the spec claim about refusing plaintext relay holds',
  /no session key — the other device may need to reload/.test(core)
  && /if \(!this\.key\) \{/.test(core),
  'the relay path throws rather than sending plaintext');
check('the spec claim about forward secrecy holds',
  /generateKey\(ECDH/.test(core) && /deriveBits/.test(core),
  'ephemeral keypairs, per session');
check('the spec claim about authenticating the exchange holds',
  /peer key failed authentication/.test(core));
check('the spec claim about ordered processing holds',
  /this\.inbound/.test(core), 'a single promise chain per link');
check('the spec claim about filename sanitising holds',
  fs.existsSync(path.join(ROOT, 'public/assets/filename.js'))
  && /safeFilename/.test(core));

console.log(bad ? `\n  ${bad} FAILED — the spec and the code disagree\n`
                : '\n  SPEC MATCHES IMPLEMENTATION\n');
process.exit(bad ? 1 : 0);

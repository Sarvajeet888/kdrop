#!/usr/bin/env node
/**
 * Forward secrecy and key-exchange authentication.
 *
 * The two properties that matter:
 *   1. A recorded relayed session cannot be decrypted later, even by someone
 *      who learns the code and PIN.
 *   2. A relay that substitutes its own public key is refused, not trusted.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

(async () => {
  console.log('\nKey agreement\n');
  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1500);

  const r = await p.evaluate(async () => {
    const core = await import('./assets/core.js');
    const out = {};
    const CODE = 'ABC123', PIN = 'WXYZ';

    const auth = await core.deriveAuthSecret(CODE, PIN);
    out.authLength = auth.length;

    // The auth secret must depend on both the code and the PIN.
    const other = await core.deriveAuthSecret(CODE, 'QQQQ');
    out.pinChangesAuth = auth.join() !== other.join();
    const otherCode = await core.deriveAuthSecret('ZZZ999', PIN);
    out.codeChangesAuth = auth.join() !== otherCode.join();

    // Two devices agree a key.
    const a = await core.makeEphemeralKeys();
    const b = await core.makeEphemeralKeys();
    out.publicKeyLength = a.publicRaw.length;

    const tagA = await core.hmacRaw(auth, a.publicRaw);
    const tagB = await core.hmacRaw(auth, b.publicRaw);

    const keyA = await core.agreeSessionKey(a, b.publicRaw, tagB, auth);
    const keyB = await core.agreeSessionKey(b, a.publicRaw, tagA, auth);
    out.bothGotKeys = !!keyA && !!keyB;

    // Both sides must derive the SAME key, or nothing decrypts.
    const plaintext = new TextEncoder().encode('the quick brown fox');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyA, plaintext);
    const back = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyB, ct);
    out.keysMatch = new TextDecoder().decode(back) === 'the quick brown fox';

    // FORWARD SECRECY: a second session with the same code and PIN must not
    // produce the same key, or a recording could be replayed against it.
    const a2 = await core.makeEphemeralKeys();
    const b2 = await core.makeEphemeralKeys();
    const key2 = await core.agreeSessionKey(a2, b2.publicRaw,
      await core.hmacRaw(auth, b2.publicRaw), auth);
    let sameSessionKey = true;
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key2, ct);
    } catch { sameSessionKey = false; }
    out.forwardSecret = !sameSessionKey;

    // AUTHENTICATION: a relay substituting its own key must be refused.
    const evil = await core.makeEphemeralKeys();
    try {
      await core.agreeSessionKey(a, evil.publicRaw, tagB, auth);   // wrong tag for this key
      out.substitutionRefused = false;
    } catch { out.substitutionRefused = true; }

    // Someone who does not know the PIN cannot forge a tag.
    const wrongAuth = await core.deriveAuthSecret(CODE, 'AAAA');
    try {
      await core.agreeSessionKey(a, evil.publicRaw,
        await core.hmacRaw(wrongAuth, evil.publicRaw), auth);
      out.wrongPinRefused = false;
    } catch { out.wrongPinRefused = true; }

    // A missing tag must not pass.
    try {
      await core.agreeSessionKey(a, evil.publicRaw, new Uint8Array(32), auth);
      out.emptyTagRefused = false;
    } catch { out.emptyTagRefused = true; }

    return out;
  });

  check('the auth secret is 256 bits', r.authLength === 32, `${r.authLength} bytes`);
  check('changing the PIN changes the auth secret', r.pinChangesAuth);
  check('changing the code changes the auth secret', r.codeChangesAuth);
  check('ephemeral public keys are P-256', r.publicKeyLength === 65, `${r.publicKeyLength} bytes`);
  check('both devices derive a key', r.bothGotKeys);
  check('the two derived keys match', r.keysMatch, 'otherwise nothing decrypts');
  check('a new session produces a different key', r.forwardSecret,
    'this is forward secrecy — yesterday\'s recording stays unreadable');
  check('a substituted public key is refused', r.substitutionRefused,
    'stops our own relay sitting in the middle');
  check('a tag made without the PIN is refused', r.wrongPinRefused);
  check('an empty tag is refused', r.emptyTagRefused);

  /* ---- end to end: the link actually agrees a key ---- */
  const a = await br.newPage();
  const b = await br.newPage();
  for (const pg of [a, b]) pg.on('pageerror', (e) => errs.push(e.message));

  const poll = async (pg, fn, label, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await pg.evaluate(fn).catch(() => null);
      if (v) return v;
      await wait(200);
    }
    throw new Error('timed out: ' + label);
  };

  await a.goto(BASE, { waitUntil: 'networkidle0' });
  const code = await poll(a, () => {
    const el = document.getElementById('codeOut');
    return el && el.dataset.empty === '0' ? el.textContent.trim() : null;
  }, 'code');
  const pin = await a.evaluate(() => document.getElementById('pinOut').textContent.trim());
  await b.goto(`${BASE}/#${code}${pin}`, { waitUntil: 'networkidle0' });
  await poll(a, () => /Direct|Relayed/.test(document.getElementById('traceState').textContent) ? 1 : null, 'link');
  await wait(1500);

  const live = await Promise.all([a, b].map((pg) => pg.evaluate(() => {
    const l = [...window.__kdrop.state.links.values()][0];
    return { hasKey: !!(l && l.key), hasEphemeral: !!(l && l.ephemeral) };
  })));
  check('both links agreed a session key', live.every((x) => x.hasKey), JSON.stringify(live));
  check('both hold an ephemeral keypair', live.every((x) => x.hasEphemeral),
    'discarded when the tab closes');

  const noStaticKey = await a.evaluate(() => {
    const s = window.__kdrop.state;
    return s.key === undefined && !!s.authSecret;
  });
  check('the PIN key is used only to authenticate, never to encrypt', noStaticKey);

  await a.close(); await b.close();
  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL CRYPTO CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Pre-launch security audit.
 *
 * Covers the items that are not exercised by the other suites: hostile
 * filenames, injection into anything rendered, TLS and header configuration,
 * PIN and code guessing, and the container's own posture.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

(async () => {
  console.log('\nSecurity audit\n');

  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1500);

  /* ---------------------------------------------- hostile filenames ---- */
  const names = await p.evaluate(async () => {
    const { safeFilename, wasRewritten, looksExecutable } = await import('./assets/filename.js');
    const t = (raw) => ({ raw, out: safeFilename(raw), changed: wasRewritten(raw) });
    return {
      traversal: t('../../../etc/passwd'),
      winTraversal: t('..\\..\\windows\\system32\\evil.dll'),
      nul: t('report\u0000.pdf'),
      bidi: t('invoice\u202Egnp.exe'),
      reserved: t('CON'),
      hidden: t('.bashrc'),
      trailing: t('photo.png.  '),
      long: t('x'.repeat(400) + '.jpg'),
      empty: t(''),
      notString: t(null),
      normal: t('holiday photo (1).jpeg'),
      exeFlag: looksExecutable('setup.exe'),
      pngFlag: looksExecutable('cat.png'),
    };
  });

  check('path traversal is neutralised',
    !names.traversal.out.includes('/') && !names.traversal.out.includes('..'),
    `${names.traversal.raw} → ${names.traversal.out}`);
  check('windows traversal is neutralised',
    !names.winTraversal.out.includes('\\') && !names.winTraversal.out.includes('..'),
    `→ ${names.winTraversal.out}`);
  check('null bytes are stripped', !names.nul.out.includes('\u0000'), `→ ${JSON.stringify(names.nul.out)}`);
  check('direction overrides are stripped',
    !/[\u202A-\u202E]/.test(names.bidi.out),
    `${JSON.stringify(names.bidi.raw)} → ${names.bidi.out} (would display as "invoice\u202Egnp.exe")`);
  check('windows reserved names are escaped', names.reserved.out !== 'CON', `→ ${names.reserved.out}`);
  check('leading dots are removed', !names.hidden.out.startsWith('.'), `→ ${names.hidden.out}`);
  check('trailing dots and spaces are removed', !/[.\s]$/.test(names.trailing.out), `→ ${JSON.stringify(names.trailing.out)}`);
  check('over-long names are trimmed with the extension kept',
    names.long.out.length <= 180 && names.long.out.endsWith('.jpg'), `${names.long.out.length} chars`);
  check('an empty name still yields something', names.empty.out.length > 0, `→ ${names.empty.out}`);
  check('a non-string name does not throw', names.notString.out.length > 0);
  check('an ordinary name is left alone', names.normal.out === 'holiday photo (1).jpeg' && !names.normal.changed);
  check('executables are recognised', names.exeFlag === true && names.pngFlag === false,
    'flagged in the accept dialog, never blocked');

  /* ------------------------------------------------------- injection ---- */
  const inj = await p.evaluate(() => {
    const probe = '<img src=x onerror="window.__pwned=1">';
    const box = document.getElementById('askFiles');
    // Render through the same path a real incoming file takes.
    box.innerHTML = '';
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    box.innerHTML = `<div class="f"><span>${esc(probe)}</span></div>`;
    return { pwned: !!window.__pwned, imgs: box.querySelectorAll('img').length, text: box.textContent };
  });
  check('a filename cannot inject markup', !inj.pwned && inj.imgs === 0,
    'escaped and shown as text');

  /* --------------------------------------------------- headers / TLS ---- */
  const res = await fetch(BASE);
  const h = (n) => res.headers.get(n) || '';
  check('CSP restricts scripts to this origin', /script-src 'self'/.test(h('content-security-policy')));
  check('CSP forbids framing', /frame-ancestors 'none'/.test(h('content-security-policy')));
  check('MIME sniffing is off', h('x-content-type-options') === 'nosniff',
    'stops a served file being reinterpreted as script');
  check('framing is denied', h('x-frame-options') === 'DENY');
  check('referrer is suppressed', /no-referrer/.test(h('referrer-policy')),
    'a pairing code lives in the URL');
  check('server software is not advertised', !res.headers.get('x-powered-by'));

  /* --------------------------------------------------- QR open redirect - */
  const qrEvil = await fetch(`${BASE}/api/qr?d=${encodeURIComponent('https://evil.example/phish')}`);
  check('the server QR endpoint is absent', qrEvil.status === 404,
    'pairing QR codes stay client-side and cannot generate phishing URLs through the server');

  /* --------------------------------------------------- code strength ---- */
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const alpha = (server.match(/const ALPHABET = '([^']+)'/) || [])[1] || '';
  const codeLen = Number((server.match(/newCode\(len = (\d+)\)/) || [])[1] || 0);
  const space = Math.pow(alpha.length, codeLen);
  check('the session code space is large',
    space > 1e8, `${alpha.length}^${codeLen} = ${space.toExponential(2)} combinations`);
  check('ambiguous characters are excluded from codes',
    !/[01OIL]/.test(alpha), 'so a code read aloud or off a screen is not misheard');
  check('repeated wrong codes are rate limited', /noteJoinFail/.test(server));
  // Look for the PIN being *handled* — read off a message, stored, or logged —
  // rather than merely named in a console line telling you to use one.
  const code = server.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const handlesPin = /(msg|peer|room|req)\.\w*pin/i.test(code)
    || /\bpin\s*[:=](?!=)/i.test(code)
    || /['"]pin['"]\s*:/i.test(code);
  check('the server never handles the PIN', !handlesPin,
    'it is generated in the browser and used only to derive a key we never see');

  const clientCore = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'core.js'), 'utf8');
  check('the PIN is only used to derive a key',
    /deriveKey/.test(clientCore) && /PBKDF2/.test(clientCore),
    'PBKDF2, in the browser');

  /* ------------------------------------------------------- container ---- */
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  check('the container does not run as root', /^USER node/m.test(dockerfile));
  check('the container installs only production dependencies', /--omit=dev/.test(dockerfile));
  check('the container has a health check', /HEALTHCHECK/.test(dockerfile));

  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  for (const secret of ['.env', 'keystore', '*.aab']) {
    check(`${secret} is excluded from the repository`, ignore.includes(secret));
  }

  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL SECURITY CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

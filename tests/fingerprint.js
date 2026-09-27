#!/usr/bin/env node
/**
 * Device fingerprints.
 *
 * The property that matters: two devices that genuinely agreed a key show the
 * SAME code, and any interference produces a DIFFERENT one. A fingerprint that
 * matched regardless would be worse than none — it would give people false
 * confidence in a check that proves nothing.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

async function poll(p, fn, l, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await p.evaluate(fn).catch(() => null);
    if (v) return v;
    await wait(200);
  }
  throw new Error('timed out: ' + l);
}

(async () => {
  console.log('\nDevice fingerprints\n');
  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1400);

  const r = await p.evaluate(async () => {
    const core = await import('./assets/core.js');
    const out = {};

    const a = await core.makeEphemeralKeys();
    const b = await core.makeEphemeralKeys();

    // Each side computes it from its own key and the other's.
    const fromA = await core.deviceFingerprint(a.publicRaw, b.publicRaw);
    const fromB = await core.deviceFingerprint(b.publicRaw, a.publicRaw);
    out.sameBothWays = fromA === fromB;
    out.sample = fromA;
    out.shape = /^[A-Z2-9]{4} [A-Z2-9]{4} [A-Z2-9]{4}$/.test(fromA);
    out.noConfusables = !/[01OIL]/.test(fromA.replace(/ /g, ''));

    // A third party substituting its own key must change the code.
    const evil = await core.makeEphemeralKeys();
    const tampered = await core.deviceFingerprint(a.publicRaw, evil.publicRaw);
    out.tamperingShows = tampered !== fromA;

    // Different sessions must not collide.
    const c = await core.makeEphemeralKeys();
    const d = await core.makeEphemeralKeys();
    out.differentSessions = (await core.deviceFingerprint(c.publicRaw, d.publicRaw)) !== fromA;

    // Deterministic — the same inputs always give the same code, or a person
    // comparing screens would see a mismatch on a healthy connection.
    out.stable = (await core.deviceFingerprint(a.publicRaw, b.publicRaw)) === fromA;

    out.missingInput = (await core.deviceFingerprint(a.publicRaw, null)) === null;
    return out;
  });

  check('both devices compute the same code', r.sameBothWays, r.sample);
  check('the code is three groups of four', r.shape, r.sample);
  check('no easily-confused characters', r.noConfusables, 'these get read aloud');
  check('a substituted key changes the code', r.tamperingShows,
    'this is the entire point of showing it');
  check('a different session gives a different code', r.differentSessions);
  check('the same inputs always give the same code', r.stable);
  check('missing input returns nothing rather than a fake code', r.missingInput);

  /* ---- end to end: two real devices, same code on both screens ---- */
  const a = await br.newPage();
  const b = await br.newPage();
  for (const pg of [a, b]) pg.on('pageerror', (e) => errs.push(e.message));

  await a.goto(BASE, { waitUntil: 'networkidle0' });
  const code = await poll(a, () => {
    const el = document.getElementById('codeOut');
    return el && el.dataset.empty === '0' ? el.textContent.trim() : null;
  }, 'code');
  const pin = await a.evaluate(() => document.getElementById('pinOut').textContent.trim());
  await b.goto(`${BASE}/#${code}${pin}`, { waitUntil: 'networkidle0' });
  await poll(a, () => /Direct|Relayed/.test(document.getElementById('traceState').textContent) ? 1 : null, 'link');
  await wait(2000);

  const shown = await Promise.all([a, b].map((pg) => pg.evaluate(() => {
    const box = document.getElementById('verifyBox');
    return { visible: !box.hidden, code: document.getElementById('verifyCode').textContent };
  })));

  check('both screens show the code', shown.every((x) => x.visible), JSON.stringify(shown.map((x) => x.visible)));
  check('the two screens agree', shown[0].code === shown[1].code && shown[0].code.length === 14,
    `${shown[0].code} vs ${shown[1].code}`);

  const linkFp = await a.evaluate(() => {
    const l = [...window.__kdrop.state.links.values()][0];
    return l ? l.fingerprint : null;
  });
  check('the link carries the fingerprint', linkFp === shown[0].code);

  await a.evaluate(() => document.getElementById('verifyYes').click());
  await wait(500);
  check('confirming dismisses the prompt',
    await a.evaluate(() => document.getElementById('verifyBox').hidden));
  check('it is remembered for the session',
    await a.evaluate(() => window.__kdrop.state.verified.size === 1),
    'asking repeatedly trains people to click through');

  await a.close(); await b.close();
  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL FINGERPRINT CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Device-level behaviour: theme, screen wake, back navigation, scanning,
 * notifications. The things that make an installed app feel like one.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

const ratio = `(a,b)=>{const lum=h=>{const n=parseInt(h.slice(1),16),r=[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]
  .map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*r[0]+.7152*r[1]+.0722*r[2];};
  const x=lum(a),y=lum(b);return +(((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2));}`;

(async () => {
  console.log('\nDevice behaviour checks\n');

  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1600);

  /* ---- theme ---- */
  // K-Drop is light only. The dark palette was removed deliberately: the brand
  // is warm paper, and a dark variant of it was never the identity.
  const scheme = await p.evaluate(() =>
    (document.querySelector('meta[name="color-scheme"]') || {}).content || '');
  check('the page declares itself light only', /light only/.test(scheme), scheme);

  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await wait(500);
  const underDark = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await wait(400);
  const underLight = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('the surface stays warm regardless of system setting',
    underDark === underLight && /237, 233, 227/.test(underLight), `${underDark} / ${underLight}`);

  const c = await p.evaluate(`(${ratio})&&(()=>{const R=${ratio};
    const cs=getComputedStyle(document.documentElement),v=n=>cs.getPropertyValue(n).trim();
    return {ink:R(v('--graphite'),v('--bone')),iron:R(v('--iron-text'),v('--bone')),verm:R(v('--vermillion-text'),v('--bone'))};})()`);
  check('text meets contrast', c.ink >= 4.5 && c.iron >= 4.5 && c.verm >= 4.5,
    `ink ${c.ink}, muted ${c.iron}, accent ${c.verm}`);

  /* ---- back navigation ---- */
  check('a history marker is in place', await p.evaluate(() => history.state?.kdrop === 'root'),
    'the back press needs something to land on');

  await p.evaluate(() => document.getElementById('ctaSend').click());
  await wait(500);
  await p.goBack();
  await wait(600);
  check('back leaves the role rather than the app',
    await p.evaluate(() => !document.body.dataset.role));

  await p.evaluate(() => { document.getElementById('ask').hidden = false; });
  await p.evaluate(() => history.pushState({ kdrop: 'root' }, ''));
  await p.goBack();
  await wait(500);
  check('back closes an open dialog', await p.evaluate(() => document.getElementById('ask').hidden));

  /* ---- pairing code survives navigation ---- */
  check('the pairing code is still in the address',
    await p.evaluate(() => /^#[A-Z0-9]{10}$/.test(location.hash)), await p.evaluate(() => location.hash));

  /* ---- scanner ---- */
  const scan = await p.evaluate(() => ({
    supported: typeof BarcodeDetector !== 'undefined',
    shown: !document.getElementById('scanRow').hidden,
  }));
  check('the scan button matches what the browser supports', scan.supported === scan.shown,
    scan.supported ? 'detector present, button shown' : 'no detector, button hidden — typing still works');

  const parsed = await p.evaluate(async () => {
    const { codeFromScan } = await import('./assets/scan.js');
    return {
      link: codeFromScan('https://kdrop.app/#ABCD12WXYZ'),
      bare: codeFromScan('abcd12wxyz'),
      junk: codeFromScan('https://example.com/nothing'),
      short: codeFromScan('ABC'),
    };
  });
  check('a K-Drop link is understood', parsed.link === 'ABCD12WXYZ', String(parsed.link));
  check('a bare code is understood', parsed.bare === 'ABCD12WXYZ', String(parsed.bare));
  check('an unrelated code is rejected', parsed.junk === null && parsed.short === null,
    'better than pairing with nonsense');

  /* ---- lifecycle ---- */
  check('screen wake lock is reachable', await p.evaluate(() => 'wakeLock' in navigator),
    'stops a sleeping phone killing a transfer');
  check('notifications are not requested on load',
    await p.evaluate(() => Notification.permission === 'default'),
    'only asked when a transfer is accepted');

  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL DEVICE CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Android-facing checks: manifest correctness, share-target handling,
 * shortcuts, and the asset-links endpoint.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

(async () => {
  console.log('\nAndroid / TWA checks\n');

  const m = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check('manifest has an id', !!m.id);
  check('manifest scope is the whole site', m.scope === '/');
  check('display is standalone', m.display === 'standalone');
  check('has a maskable icon', m.icons.some((i) => i.purpose === 'maskable'),
    'Android crops non-maskable icons badly');
  check('has a 512px icon for the store', m.icons.some((i) => i.sizes === '512x512'));
  check('declares a share target', !!m.share_target, 'this is what puts K-Drop in the Android share sheet');
  check('share target accepts files',
    !!(m.share_target && m.share_target.params && m.share_target.params.files));
  check('share target POSTs multipart',
    m.share_target?.method === 'POST' && m.share_target?.enctype === 'multipart/form-data',
    'a GET share target cannot carry files');
  check('has home-screen shortcuts', Array.isArray(m.shortcuts) && m.shortcuts.length >= 2);

  const al = await fetch(`${BASE}/.well-known/assetlinks.json`);
  check('asset links endpoint responds', al.status === 404 || al.status === 200,
    al.status === 404 ? 'not configured yet, which is correct before you have a fingerprint' : 'configured');

  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1500);

  const sw = await p.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r).catch(() => false));
  check('service worker registers', sw, 'the share target is handled inside it');

  // Drive the share flow the way Android does: stash files, then load /?shared=1
  const shared = await p.evaluate(async () => {
    const cache = await caches.open('kdrop-share');
    await cache.put('/__share_meta', new Response(JSON.stringify({
      at: Date.now(), text: '', files: [{ name: 'holiday.jpg', type: 'image/jpeg' }],
    })));
    await cache.put('/__share_file_0', new Response(new Blob([new Uint8Array(2048)])));
    return true;
  });
  check('share payload can be stashed', shared);

  await p.goto(`${BASE}/?shared=1`, { waitUntil: 'networkidle0' });
  await wait(1800);

  const picked = await p.evaluate(() => ({
    queued: !!(window.__kdrop && window.__kdrop.state.sharedPending),
    count: window.__kdrop?.state.sharedPending?.length || 0,
    name: window.__kdrop?.state.sharedPending?.[0]?.name || null,
    url: location.search,
  }));
  check('shared files reach the app', picked.queued && picked.count === 1,
    picked.name ? `picked up ${picked.name}` : 'nothing queued');
  check('share marker is cleared from the URL', !picked.url.includes('shared'),
    'otherwise a reload looks like a second share');

  const leftover = await p.evaluate(async () => {
    const c = await caches.open('kdrop-share');
    return (await c.keys()).length;
  });
  check('shared files are not left in the cache', leftover === 0,
    'a copy of someone\'s photo must not linger on disk');

  await p.goto(`${BASE}/?action=receive`, { waitUntil: 'networkidle0' });
  await wait(1200);
  check('receive shortcut opens without error', true);

  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL ANDROID CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Generates the Play Store visual package.
 *
 *   node tools/store-assets.js
 *
 * Screenshots are captured from the running app rather than mocked up, so what
 * the listing shows is what the product actually is. Two browser contexts pair
 * with each other and move a real file, exactly as a person would.
 *
 * Needs the server running and CHROME_PATH set.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const OUT = path.join(__dirname, '..', 'store', 'screenshots');

// Play accepts 16:9 or 9:16 phone screenshots; this is a common phone size at 2x.
const PHONE = { width: 412, height: 892, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Mobile Safari/537.36';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(page, fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await wait(200);
  }
  throw new Error(`timed out: ${label}`);
}

/**
 * Scroll so a given element sits just below the sticky header, rather than
 * relying on scrollIntoView — which happily leaves the next section bleeding
 * into the frame.
 */
async function frame(page, selector, pad = 78) {
  await page.evaluate((sel, p) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - p;
    window.scrollTo(0, Math.max(0, y));
  }, selector, pad);
  await wait(400);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${name}.png`);
  return file;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('\nCapturing store screenshots from the running app\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });

  const phone = await browser.newPage();
  await phone.setViewport(PHONE);
  await phone.setUserAgent(UA);

  /* 1 — the first screen, before anything is chosen */
  await phone.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(2200);
  await shot(phone, '01-home');

  /* 2 — pairing: the code and QR a person actually reads */
  await phone.evaluate(() => document.getElementById('ctaSend').click());
  await wait(900);
  await frame(phone, '#cardPair');
  await shot(phone, '02-pairing');

  const code = await poll(phone, () => {
    const el = document.getElementById('codeOut');
    return el && el.dataset.empty === '0' ? el.textContent.trim() : null;
  }, 'pairing code');
  const pin = await phone.evaluate(() => document.getElementById('pinOut').textContent.trim());

  /* a second device joins, so the rest is a genuine session */
  const laptop = await browser.newPage();
  await laptop.setViewport({ width: 1280, height: 900 });
  await laptop.goto(`${BASE}/#${code}${pin}`, { waitUntil: 'networkidle0' });
  await laptop.evaluate(() => {
    const o = new MutationObserver(() => {
      const s = document.getElementById('ask');
      if (!s.hidden) { o.disconnect(); document.getElementById('askYes').click(); }
    });
    o.observe(document.getElementById('ask'), { attributes: true });
  });

  await poll(phone, () => /Direct|Relayed/.test(document.getElementById('traceState').textContent) ? 1 : null, 'link');
  await wait(800);

  /* 3 — connected, showing the other device and the route */
  await frame(phone, '#cardSend');
  await shot(phone, '03-connected');

  /* 4 — a transfer actually in flight */
  await phone.evaluate(async () => {
    const N = 48 * 1024 * 1024;
    const b = new Uint8Array(N);
    const dt = new DataTransfer();
    dt.items.add(new File([b], 'trip-photos.zip', { type: 'application/zip' }));
    const i = document.getElementById('fileInput');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await poll(phone, () => {
    const st = document.querySelector('#transfers .t .st');
    return st && /MB of/.test(st.textContent) ? 1 : null;
  }, 'progress');
  await wait(500);
  await frame(phone, '#cardSend .tabs', 78);
  await shot(phone, '04-transferring');

  /* 5 — finished, with the history that follows */
  await poll(phone, () => document.querySelector('#transfers .t.done') ? 1 : null, 'complete', 120000);
  await wait(900);
  await frame(phone, '#cardSend .tabs', 78);
  await shot(phone, '05-complete');

  /* 6 — how it works, in the app's own words */
  await phone.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1500);
  await frame(phone, '#how', 0);
  await shot(phone, '06-how-it-works');

  /* 7 — privacy, which is the reason to choose this over the alternatives */
  await phone.goto(`${BASE}/docs.html#privacy`, { waitUntil: 'networkidle0' });
  await wait(1200);
  await shot(phone, '07-privacy');

  /* 8 — the same first screen in dark mode */
  await phone.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await phone.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(2000);
  await shot(phone, '08-dark');

  await browser.close();

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png'));
  console.log(`\n  ${files.length} screenshots in store/screenshots/`);
  console.log('  Play needs at least 2; up to 8 are shown. Use them in this order.\n');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

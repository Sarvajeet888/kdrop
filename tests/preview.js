#!/usr/bin/env node
/**
 * Previews, summary, install offer and adaptive framing.
 *
 * The preview check that matters: a thumbnail is decoded from a local file and
 * never transmitted. Sending one would put image data on the wire that the
 * person never chose to send.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
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
  console.log('\nPreviews, summary and framing\n');
  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1300);

  const r = await p.evaluate(async () => {
    const { kindOf, thumbnail, previewAll } = await import('./assets/preview.js');
    const out = {};

    out.kinds = {
      photo: kindOf('holiday.jpg', 'image/jpeg'),
      clip: kindOf('clip.mp4', 'video/mp4'),
      song: kindOf('song.mp3', ''),
      zip: kindOf('backup.zip', ''),
      pdf: kindOf('invoice.pdf', ''),
      sheet: kindOf('budget.xlsx', ''),
      code: kindOf('server.js', ''),
      unknown: kindOf('thing.qqq', ''),
    };

    // A real PNG, drawn here rather than fetched.
    const c = document.createElement('canvas');
    c.width = 60; c.height = 40;
    const g = c.getContext('2d');
    g.fillStyle = '#de4b22'; g.fillRect(0, 0, 60, 40);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));

    const thumb = await thumbnail(blob, 'square.png');
    out.madeThumb = typeof thumb === 'string' && thumb.startsWith('data:image/jpeg');
    out.thumbSmall = thumb ? thumb.length < 20000 : false;

    // Non-images must not produce one.
    out.noThumbForText = (await thumbnail(new Blob(['hello'], { type: 'text/plain' }), 'a.txt')) === null;
    out.noThumbForNull = (await thumbnail(null, 'x.png')) === null;

    // Only the first few decode, so a huge folder cannot lock the tab.
    const many = Array.from({ length: 12 }, (_, i) => new File([blob], `p${i}.png`, { type: 'image/png' }));
    const list = await previewAll(many, 4);
    out.previewCount = list.length;
    out.decodedCount = list.filter((x) => x.thumb).length;

    return out;
  });

  check('recognises an image', r.kinds.photo === 'image');
  check('recognises a video', r.kinds.clip === 'video');
  check('recognises audio', r.kinds.song === 'audio');
  check('recognises an archive', r.kinds.zip === 'archive');
  check('recognises a document', r.kinds.pdf === 'pdf' && r.kinds.sheet === 'sheet');
  check('recognises code', r.kinds.code === 'code');
  check('falls back for anything else', r.kinds.unknown === 'file');
  check('makes a thumbnail from an image', r.madeThumb);
  check('the thumbnail is small', r.thumbSmall, 'a full-size decode would sit in memory');
  check('no thumbnail for a text file', r.noThumbForText);
  check('no thumbnail from nothing', r.noThumbForNull);
  check('every file is listed', r.previewCount === 12, `${r.previewCount}`);
  check('only the first few are decoded', r.decodedCount === 4,
    `${r.decodedCount} decoded — a folder of thousands must not lock the tab`);

  /* ---- thumbnails must never be transmitted ---- */
  const core = fs.readFileSync(path.join(ROOT, 'public/assets/core.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
  check('no thumbnail is ever sent over the wire',
    !/thumb/i.test(core) && !/send\([^)]*thumb/i.test(app),
    'previews are generated locally on both sides');

  /* ---- end to end: summary appears with real numbers ---- */
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
  await b.evaluate(() => {
    const o = new MutationObserver(() => {
      const s = document.getElementById('ask');
      if (!s.hidden) { o.disconnect(); document.getElementById('askYes').click(); }
    });
    o.observe(document.getElementById('ask'), { attributes: true });
  });
  await poll(a, () => /Direct|Relayed/.test(document.getElementById('traceState').textContent) ? 1 : null, 'link');

  await a.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 80;
    c.getContext('2d').fillRect(0, 0, 80, 80);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'photo.png', { type: 'image/png' }));
    const i = document.getElementById('fileInput');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await poll(a, () => document.querySelector('#transfers .t.done') ? 1 : null, 'sent', 60000);
  await wait(900);

  check('a preview strip appears for the sender',
    await a.evaluate(() => !!document.querySelector('.preview-strip')));
  check('the image gets a real thumbnail',
    await a.evaluate(() => !!document.querySelector('.preview-strip img.thumb')));

  const summary = await a.evaluate(() => {
    const el = document.querySelector('.summary');
    return el ? el.textContent : null;
  });
  check('a summary appears when it finishes', !!summary, summary || '');
  check('the summary states the route', /Direct|Relayed/.test(summary || ''));

  /* ---- bounded framing ---- */
  const frames = await a.evaluate(() => {
    const l = [...window.__kdrop.state.links.values()][0];
    if (!l || l.mode !== 'direct') return null;
    const idle = l.chunkSize;
    // Queue backpressure bounds in-flight data without adding smaller-frame overhead.
    Object.defineProperty(l, 'buffered', { get: () => 3 * 1024 * 1024, configurable: true });
    const busy = l.chunkSize;
    return { idle, busy };
  });
  if (frames) {
    check('frames stay stable when the link backs up', frames.busy === frames.idle,
      `${frames.idle} idle → ${frames.busy} busy`);
    check('frames never exceed the safe ceiling', frames.idle <= 65536, `${frames.idle} bytes`);
  } else {
    console.log('  skip  direct framing (relayed route)');
  }

  await a.close(); await b.close();
  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL PREVIEW CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

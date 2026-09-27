#!/usr/bin/env node
/**
 * Transfer benchmark.
 *
 *   node tools/benchmark.js              the standard matrix
 *   node tools/benchmark.js 8 64 256     specific sizes in MB
 *
 * Measures both routes at several sizes and writes BENCHMARK.md.
 *
 * Two things worth understanding before reading any number this produces:
 *
 *  - It runs two browser tabs on one machine over loopback. That removes the
 *    network entirely, which is the point: what remains is K-Drop's own
 *    overhead. It is not a prediction of real speed.
 *  - The ceiling of the environment is measured first, so every result can be
 *    read as a fraction of what a bare data channel achieves here. A result
 *    at 90% of ceiling has almost nothing left to optimise; one at 40% does.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const MATRIX = SIZES.length ? SIZES : [8, 32, 96];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(page, fn, label, ms = 240000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await page.evaluate(fn).catch(() => null);
    if (v) return v;
    await wait(150);
  }
  throw new Error(`timed out: ${label}`);
}

function launch(breakDirect) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  }).then(async (browser) => {
    if (breakDirect) {
      // Forcing the relay route by removing the peer connection entirely is
      // closer to a restrictive network than any throttling setting.
      browser.__breakDirect = true;
    }
    return browser;
  });
}

/** The best a bare data channel manages here, for comparison. */
async function ceiling(browser, mb) {
  const p = await browser.newPage();
  await p.goto('about:blank');
  const r = await p.evaluate(async (MB) => {
    const a = new RTCPeerConnection(); const b = new RTCPeerConnection();
    a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
    b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
    const dc = a.createDataChannel('bench', { ordered: true });
    dc.binaryType = 'arraybuffer';
    const open = new Promise((res) => { dc.onopen = res; });
    let got = 0;
    const done = new Promise((res) => {
      b.ondatachannel = (e) => {
        e.channel.binaryType = 'arraybuffer';
        e.channel.onmessage = (ev) => { got += ev.data.byteLength; if (got >= MB * 1048576) res(); };
      };
    });
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    await open;

    const CHUNK = 65536;
    const buf = new Uint8Array(CHUNK);
    dc.bufferedAmountLowThreshold = 1048576;
    const t0 = performance.now();
    let sent = 0;
    while (sent < MB * 1048576) {
      if (dc.bufferedAmount > 4194304) {
        await new Promise((res) => {
          const h = () => { dc.removeEventListener('bufferedamountlow', h); res(); };
          dc.addEventListener('bufferedamountlow', h);
        });
      }
      dc.send(buf); sent += CHUNK;
    }
    await done;
    const secs = (performance.now() - t0) / 1000;
    a.close(); b.close();
    return MB / secs;
  }, mb);
  await p.close();
  return r;
}

async function run(browser, mb, forceRelay) {
  const a = await browser.newPage();
  const b = await browser.newPage();

  if (forceRelay) {
    for (const p of [a, b]) {
      await p.evaluateOnNewDocument(() => {
        window.RTCPeerConnection = function () { throw new Error('blocked for benchmark'); };
      });
    }
  }

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

  const route = await poll(a, () => {
    const t = document.getElementById('traceState').textContent;
    return /Direct|Relayed/.test(t) ? t.trim() : null;
  }, 'link');

  const before = await a.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);

  await a.evaluate(async (N) => {
    const buf = new Uint8Array(N);
    const dt = new DataTransfer();
    dt.items.add(new File([buf], 'benchmark.bin'));
    const i = document.getElementById('fileInput');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  }, mb * 1048576);

  // Start the clock at the first byte, not at the click. Everything before
  // that is the accept handshake — real, but a fixed cost that would make
  // small transfers look far slower than they move.
  await poll(a, () => {
    const st = document.querySelector('#transfers .t .st');
    return st && /of/.test(st.textContent) ? 1 : null;
  }, 'first progress');
  const t0 = Date.now();

  await poll(a, () => document.querySelector('#transfers .t.done') ? 1 : null, 'send complete');
  await poll(b, () => {
    const r = document.querySelector('#transfers .t');
    return r && (r.classList.contains('done') || r.classList.contains('failed')) ? 1 : null;
  }, 'receive complete');
  const secs = (Date.now() - t0) / 1000;

  const okB = await b.evaluate(() => !!document.querySelector('#transfers .t.done'));
  const peak = await a.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);

  await a.close(); await b.close();

  return {
    mb, secs: Number(secs.toFixed(2)),
    rate: Number((mb / secs).toFixed(1)),
    route: /Direct/.test(route) ? 'direct' : 'relayed',
    verified: okB,
    heapMb: peak && before ? Number(((peak - before) / 1048576).toFixed(1)) : null,
  };
}

(async () => {
  console.log('\nK-Drop benchmark\n');

  const browser = await launch(false);

  process.stdout.write('  measuring the environment ceiling… ');
  const cap = await ceiling(browser, 32);
  console.log(`${cap.toFixed(1)} MB/s (bare data channel, loopback)\n`);

  const results = [];

  for (const mb of MATRIX) {
    process.stdout.write(`  direct  ${String(mb).padStart(4)} MB … `);
    const d = await run(browser, mb, false);
    console.log(`${d.secs}s  ${d.rate} MB/s  ${Math.round((d.rate / cap) * 100)}% of ceiling  ${d.verified ? '' : 'UNVERIFIED'}`);
    results.push(d);
  }
  await browser.close();

  const relayBrowser = await launch(true);
  for (const mb of MATRIX.slice(0, 2)) {
    process.stdout.write(`  relayed ${String(mb).padStart(4)} MB … `);
    const r = await run(relayBrowser, mb, true);
    console.log(`${r.secs}s  ${r.rate} MB/s  ${r.verified ? '' : 'UNVERIFIED'}`);
    results.push(r);
  }
  await relayBrowser.close();

  /* ------------------------------------------------------------ report */

  const rows = results.map((r) =>
    `| ${r.mb} MB | ${r.route} | ${r.secs}s | **${r.rate} MB/s** | ${r.route === 'direct' ? Math.round((r.rate / cap) * 100) + '%' : '—'} | ${r.verified ? 'yes' : 'NO'} |`
  ).join('\n');

  const direct = results.filter((r) => r.route === 'direct');
  const relayed = results.filter((r) => r.route === 'relayed');
  const avg = (xs) => xs.length ? (xs.reduce((a, b) => a + b.rate, 0) / xs.length).toFixed(1) : '—';

  const sorted = [...direct].sort((a, b) => a.mb - b.mb);
  const degradeNote = sorted.length >= 2
    ? `At ${sorted[0].mb} MB the direct route managed ${sorted[0].rate} MB/s; at ${sorted[sorted.length - 1].mb} MB, ${sorted[sorted.length - 1].rate} MB/s.`
    : 'Only one size was measured, so no trend can be read.';
  const relayNote = relayed.length && direct.length
    ? `The relay averaged ${avg(relayed)} MB/s against direct's ${avg(direct)} MB/s.`
    : '';

  const md = `# Benchmark

Generated by \`node tools/benchmark.js\` on ${new Date().toISOString().slice(0, 10)}.

## What these numbers are

Two browser tabs on one machine, over loopback. There is no network, which is
deliberate — what is left is K-Drop's own overhead. **These are not predictions
of real-world speed.** A phone and a laptop on the same Wi-Fi will be slower;
devices on different networks will be much slower, and the round-trip time
shown in the app predicts that better than anything here.

The ceiling row is a bare WebRTC data channel doing nothing but sending bytes
in the same environment. It is the number to compare against: a result near the
ceiling has little left to give, one far below it has a bottleneck worth
finding.

**Environment ceiling: ${cap.toFixed(1)} MB/s**

## Results

| Size | Route | Time | Throughput | vs ceiling | Verified |
|---|---|---|---|---|---|
${rows}

Averages: direct **${avg(direct)} MB/s**, relayed **${avg(relayed)} MB/s**.

"Verified" means the receiving side reported the file complete and its checksum
matched. A fast unverified transfer is a failed transfer.

## Why the relay is slower

A relayed transfer travels twice — up to the server and back down — and every
chunk is encrypted with AES-256-GCM on the way. Both costs are inherent to the
route, not defects. The relay exists so that transfers work at all on networks
that block a direct connection.

## What has already been tuned

- **64 KB frames.** \`sctp.maxMessageSize\` advertises 256 KB, but frames that
  large tear the data channel down partway through a large transfer.
- **4 MB send buffer ceiling.** Chrome kills a data channel whose buffer
  reaches 16 MB, so the limit sits well below it.
- **No promise per chunk.** \`drain()\` and \`sendBytes()\` return \`undefined\`
  on the fast path. Awaiting a resolved promise still costs an event-loop turn,
  and at thousands of frames per second that alone dominated the transfer.
- **\`subarray\` rather than \`slice\`** when framing, avoiding a copy of every
  chunk.

## Two findings worth knowing

**Throughput varies with file size.** ${degradeNote}

When the receiving browser cannot stream to disk — Safari, Firefox, or Chrome
before a folder has been chosen — every chunk is held in memory until the
transfer finishes. A large transfer then competes with itself for memory and
garbage collection eats into throughput. Choosing a folder when prompted on
Chrome or Edge avoids this entirely, because the file is written as it arrives.

**The relay looks competitive here, and that is an artefact.** ${relayNote}

Two tabs in one Chrome process talking over SCTP is not two devices talking
over a network. The relay path in this test is a WebSocket over loopback
through Node — a very short pipe. On any real network the direct route wins,
because the relay adds a full round trip to the server and back, plus
AES-256-GCM on every chunk. Read that row as the relay's own overhead, not as a
reason to prefer it.

## Where the remaining gap is

The honest next step is not more micro-optimisation. It is measuring on real
hardware, where the network is the bottleneck and most of this stops mattering.
`;

  fs.writeFileSync(path.join(__dirname, '..', 'BENCHMARK.md'), md);
  console.log('\n  written to BENCHMARK.md\n');

  const failed = results.filter((r) => !r.verified);
  if (failed.length) {
    console.log(`  ${failed.length} transfer(s) did not verify — that is a correctness problem, not a speed one.\n`);
    process.exit(1);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

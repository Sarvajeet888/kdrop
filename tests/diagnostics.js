#!/usr/bin/env node
/**
 * Connection diagnostics.
 *
 * This panel exists because performance questions could not be answered from
 * a test container. It has to work on the device where the problem is, so it
 * is tested like anything else.
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
  console.log('\nConnection diagnostics\n');
  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const a = await br.newPage();
  const b = await br.newPage();
  const errs = [];
  a.on('pageerror', (e) => errs.push(e.message));

  await a.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1200);

  await a.evaluate(() => {
    const box = document.getElementById('diagBox');
    box.open = true;
    box.dispatchEvent(new Event('toggle'));
  });
  await wait(600);
  check('says so plainly when nothing is connected',
    await a.evaluate(() => /Connect a device/i.test(document.getElementById('diagBody').textContent)));

  const code = await poll(a, () => {
    const e = document.getElementById('codeOut');
    return e && e.dataset.empty === '0' ? e.textContent.trim() : null;
  }, 'code');
  const pin = await a.evaluate(() => document.getElementById('pinOut').textContent.trim());
  await b.goto(`${BASE}/#${code}${pin}`, { waitUntil: 'networkidle0' });
  await poll(a, () => /Direct|Relayed/.test(document.getElementById('traceState').textContent) ? 1 : null, 'link');
  await wait(2600);

  const rows = await a.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('.diag-row')) {
      out[r.querySelector('.k').textContent] = r.querySelector('.v').textContent;
    }
    return out;
  });

  check('reports the route', /Direct|Relayed/.test(rows.Route || ''), rows.Route);
  check('reports a round-trip time', /ms$/.test(rows['Round trip'] || ''), rows['Round trip']);
  check('reports the network path', /\w+\/\w+/.test(rows['Network path'] || ''),
    `${rows['Network path']} — host/host means the same network`);
  check('reports the encryption state', /Session key|browser/i.test(rows.Encryption || ''), rows.Encryption);
  check('reports the frame size', /KB$/.test(rows['Frame size'] || ''), rows['Frame size']);
  check('reports whether it can stream to disk', !!rows['Writes to disk'], rows['Writes to disk']);

  const report = await a.evaluate(async () => {
    const { asText, readStats } = await import('./assets/diagnostics.js');
    const link = [...window.__kdrop.state.links.values()][0];
    return asText(window.__kdrop.state, await readStats(link),
      { mode: link.mode, chunkSize: link.chunkSize, secure: !!link.key });
  });
  check('produces a copyable report', report.includes('K-Drop diagnostics') && report.includes('round trip'));
  check('the report carries no session code or PIN',
    !report.includes(code) && !report.includes(pin),
    'a diagnostics paste must not hand over the keys to a session');

  // Judgements a person can act on.
  const judged = await a.evaluate(async () => {
    const d = await import('./assets/diagnostics.js');
    return {
      fast: d.describeRtt(8).quality,
      middling: d.describeRtt(50).quality,
      slow: d.describeRtt(268).quality,
      slowAdvice: d.describeRtt(268).advice,
      hostPair: d.describeRoute({ localType: 'host', remoteType: 'host' }).quality,
      relayPair: d.describeRoute({ localType: 'relay', remoteType: 'srflx' }).quality,
      relayAdvice: d.describeRoute({ localType: 'relay', remoteType: 'srflx' }).advice,
    };
  });
  check('20ms is judged best', judged.fast === 'best');
  check('50ms is judged acceptable', judged.middling === 'ok');
  check('268ms is judged poor and advises the same Wi-Fi',
    judged.slow === 'poor' && judged.slowAdvice === 'sameWifi',
    'this is the number from the real-world screenshot');
  check('a same-network pair is judged best', judged.hostPair === 'best');
  check('a relayed pair advises TURN', judged.relayPair === 'poor' && judged.relayAdvice === 'turn');

  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL DIAGNOSTICS CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

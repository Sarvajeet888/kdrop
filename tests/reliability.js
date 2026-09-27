#!/usr/bin/env node
/**
 * Reliability: failures must become recoverable states, not dead ends.
 *
 * Every check here breaks something on purpose and then asks whether the app
 * came back — or, where it genuinely cannot, whether it said so instead of
 * sitting silently on a stalled progress bar.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

// Recovery involves a reconnect, a fresh WebRTC negotiation and a resume
// handshake. On a loaded machine that is comfortably slower than it looks, so
// the waits here are generous on purpose — a test that fails under load
// teaches people to ignore it.
async function poll(p, fn, label, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await p.evaluate(fn).catch(() => null);
    if (v) return v;
    await wait(200);
  }
  throw new Error(`timed out: ${label}`);
}

async function pair(browser) {
  const a = await browser.newPage();
  const b = await browser.newPage();
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
  return { a, b, code, pin };
}

(async () => {
  console.log('\nReliability — breaking things on purpose\n');

  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });

  /* ---- signalling drops while idle: must rejoin the same room ---- */
  {
    const { a, b, code } = await pair(br);
    await a.evaluate(() => { try { window.__kdrop.signal.ws.close(); } catch {} });
    await wait(200);
    check('a dropped connection is announced, not hidden',
      await a.evaluate(() => document.getElementById('netState').dataset.state === 'down'));

    const back = await poll(a, () => document.getElementById('netState').dataset.state === 'on' ? 1 : null,
      'reconnect', 45000);
    check('the connection comes back on its own', !!back);
    check('it returns to the same session, not a new one',
      await a.evaluate(() => window.__kdrop.state.code) === code,
      'a new code would strand the other device');
    await a.close(); await b.close();
  }

  /* ---- the other device leaves mid-session ---- */
  {
    const { a, b } = await pair(br);
    await b.close();
    const gone = await poll(a, () => document.querySelectorAll('#peers .peer').length === 0 ? 1 : null,
      'peer removal', 30000);
    check('a departing device is removed from the list', !!gone);
    check('sending is disabled once nobody is there',
      await a.evaluate(() => document.getElementById('cardSend').classList.contains('off')),
      'better than a send button that silently does nothing');
    await a.close();
  }

  /* ---- transfer interrupted by a real disconnect ---- */
  {
    const { a, b } = await pair(br);
    await a.evaluate(async () => {
      const N = 12 * 1024 * 1024;
      const buf = new Uint8Array(N);
      for (let i = 0; i < N; i += 512) buf[i] = i & 255;
      const dt = new DataTransfer();
      dt.items.add(new File([buf], 'reliability.bin'));
      const i = document.getElementById('fileInput');
      i.files = dt.files;
      i.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await poll(a, () => {
      const st = document.querySelector('#transfers .t .st');
      const m = st && st.textContent.match(/([\d.]+)\s*MB of/);
      return m && parseFloat(m[1]) > 2 ? 1 : null;
    }, 'partial progress');

    await a.evaluate(() => {
      const { state, signal } = window.__kdrop;
      for (const l of state.links.values()) {
        try { l.dc && l.dc.close(); } catch {}
        try { l.pc && l.pc.close(); } catch {}
      }
      try { signal.ws.close(); } catch {}
    });

    const outcome = await poll(a, () => {
      const r = document.querySelector('#transfers .t');
      if (!r) return null;
      if (r.classList.contains('done')) return 'recovered';
      if (r.classList.contains('failed')) return 'failed: ' + r.querySelector('.st').textContent;
      return null;
    }, 'recovery', 180000);
    check('an interrupted transfer recovers', outcome === 'recovered', outcome);

    if (outcome === 'recovered') {
      // The sender reporting "done" only means it finished writing to the
      // wire. The receiver still has to drain, verify and save — wait for it
      // rather than racing it, or this fails on a loaded machine while the
      // app is behaving correctly.
      const received = await poll(b, () => {
        const r = document.querySelector('#transfers .t');
        if (!r) return null;
        if (r.classList.contains('failed')) return 'failed';
        return r.classList.contains('done') ? 'done' : null;
      }, 'receiver completion', 90000);
      check('the receiving side also completes', received === 'done', received);

      const intact = await b.evaluate(async (N) => {
        const link = document.querySelector('#transfers .save');
        if (!link) return { err: 'no saved file' };
        const v = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
        if (v.length !== N) return { err: `size ${v.length}` };
        for (let i = 0; i < N; i += 512) if (v[i] !== (i & 255)) return { err: `byte ${i}` };
        return { ok: true };
      }, 12 * 1024 * 1024);
      check('the recovered file is byte-for-byte correct', intact.ok === true, intact.err || '');
    }
    await a.close(); await b.close();
  }

  /* ---- an expired session must be explained ---- */
  {
    const p = await br.newPage();
    await p.goto(BASE, { waitUntil: 'networkidle0' });
    await wait(1500);
    await p.evaluate(() => {
      document.getElementById('joinCode').value = 'ZZZZZZ9999';
      document.getElementById('joinForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    await wait(1200);
    check('an unknown session is explained and a new one started',
      await p.evaluate(() => !!document.querySelector('.toast')
        && document.getElementById('codeOut').dataset.empty === '0'),
      'never a dead screen');
    await p.close();
  }

  /* ---- the service reports its own health honestly ---- */
  {
    const m = await (await fetch(`${BASE}/api/status`)).json();
    check('status reports each component', Array.isArray(m.components) && m.components.length >= 4);
    check('status admits when TURN is not configured',
      m.components.some((c) => c.id === 'turn' && (c.ok === false || /not configured/.test(c.note || ''))),
      'a green light for something that does not exist is worse than no light');
  }

  await br.close();
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL RELIABILITY CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

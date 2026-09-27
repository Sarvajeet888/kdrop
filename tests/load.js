#!/usr/bin/env node
/**
 * K-Drop load test — signalling layer.
 *
 * Simulates N pairs of devices creating rooms, joining, exchanging signalling
 * traffic and leaving. This exercises the part that actually runs on our
 * server; the file transfer itself is peer-to-peer and costs us nothing.
 *
 *   node tests/load.js [pairs] [holdSeconds]
 *   node tests/load.js 200 10
 */
'use strict';

const WebSocket = require('ws');

const PAIRS = Number(process.argv[2] || 50);
const HOLD_S = Number(process.argv[3] || 8);
const URL = process.env.KDROP_URL || 'ws://localhost:3000/ws';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const stats = {
  created: 0, joined: 0, paired: 0, errors: 0, closed: 0,
  createMs: [], joinMs: [], signalMs: [],
};

/**
 * Open a socket and start buffering immediately.
 *
 * The server greets a new connection right away, so a listener attached after
 * the await would miss it. Everything is queued from the moment the socket
 * opens and read from the queue instead.
 */
function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { perMessageDeflate: false });
    ws.queue = [];
    ws.waiters = [];
    ws.closedWith = null;

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m; try { m = JSON.parse(data); } catch { return; }
      ws.queue.push(m);
      drain(ws);
    });
    ws.on('close', (code) => { ws.closedWith = code; drain(ws); });

    const t = setTimeout(() => reject(new Error('connect timeout')), 15000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function drain(ws) {
  for (let i = ws.waiters.length - 1; i >= 0; i--) {
    const w = ws.waiters[i];
    const idx = ws.queue.findIndex((m) => m.t === w.type || m.t === 'error');
    if (idx >= 0) {
      const m = ws.queue.splice(idx, 1)[0];
      ws.waiters.splice(i, 1);
      clearTimeout(w.timer);
      if (m.t === 'error') w.reject(new Error('server refused: ' + m.reason));
      else w.resolve(m);
    } else if (ws.closedWith != null) {
      ws.waiters.splice(i, 1);
      clearTimeout(w.timer);
      w.reject(new Error(ws.closedWith === 4008 ? 'refused: per-IP socket cap' : 'closed ' + ws.closedWith));
    }
  }
}

function once(ws, type, ms = 15000) {
  return new Promise((resolve, reject) => {
    const w = { type, resolve, reject };
    w.timer = setTimeout(() => {
      ws.waiters = ws.waiters.filter((x) => x !== w);
      reject(new Error('timed out waiting for ' + type));
    }, ms);
    ws.waiters.push(w);
    drain(ws);
  });
}

const send = (ws, o) => ws.send(JSON.stringify(o));

async function onePair(i) {
  let a, b;
  try {
    a = await open();
    await once(a, 'hello');

    let t0 = Date.now();
    send(a, { t: 'create', name: `host${i}` });
    const room = await once(a, 'room');
    stats.createMs.push(Date.now() - t0);
    stats.created++;

    b = await open();
    await once(b, 'hello');

    t0 = Date.now();
    send(b, { t: 'join', code: room.code, name: `guest${i}` });
    const joined = await once(b, 'joined');
    stats.joinMs.push(Date.now() - t0);
    stats.joined++;

    const peerId = joined.peers[0] && joined.peers[0].id;
    if (!peerId) throw new Error('no peer in room');

    // A realistic signalling exchange: offer, answer, a handful of candidates.
    t0 = Date.now();
    send(b, { t: 'signal', to: peerId, data: { desc: { type: 'offer', sdp: 'x'.repeat(1200) } } });
    const sig = await once(a, 'signal');
    stats.signalMs.push(Date.now() - t0);
    if (!sig.data.desc) throw new Error('signal mangled');

    for (let k = 0; k < 6; k++) {
      send(a, { t: 'signal', to: sig.from, data: { candidate: { candidate: 'c'.repeat(120) } } });
    }
    stats.paired++;

    // Hold the session open the way a real transfer would.
    await sleep(HOLD_S * 1000);
  } catch (e) {
    stats.errors++;
    if (stats.errors <= 5) console.error('  pair', i, '->', e.message);
  } finally {
    try { a && a.close(); } catch {}
    try { b && b.close(); } catch {}
    stats.closed++;
  }
}

(async () => {
  console.log(`\nK-Drop load test — ${PAIRS} pairs (${PAIRS * 2} sockets), holding ${HOLD_S}s`);
  console.log(`  (all traffic comes from one address, so run the server with`);
  console.log(`   MAX_SOCKETS_PER_IP and MAX_ROOMS_PER_IP raised, or the`);
  console.log(`   abuse limits will correctly refuse most of it)\n`);

  const before = await (await fetch(`${HTTP}/api/health`)).json();
  console.log(`  before: rooms=${before.rooms} rss=${before.rssMb}MB`);

  const t0 = Date.now();

  // Ramp rather than a thundering herd — closer to real arrival, and it lets
  // us see the point where latency starts climbing.
  const running = [];
  for (let i = 0; i < PAIRS; i++) {
    running.push(onePair(i));
    if (i % 25 === 24) await sleep(120);
  }

  const peak = setInterval(async () => {
    try {
      const h = await (await fetch(`${HTTP}/api/health`)).json();
      process.stdout.write(`\r  running: rooms=${h.rooms} peers=${h.peers} rss=${h.rssMb}MB   `);
    } catch {}
  }, 1000);

  await Promise.all(running);
  clearInterval(peak);
  const elapsed = (Date.now() - t0) / 1000;

  await sleep(1500);
  const after = await (await fetch(`${HTTP}/api/health`)).json();

  console.log(`\n\n  pairs attempted   ${PAIRS}`);
  console.log(`  rooms created     ${stats.created}`);
  console.log(`  joins completed   ${stats.joined}`);
  console.log(`  fully paired      ${stats.paired}`);
  console.log(`  errors            ${stats.errors}`);
  console.log(`  wall clock        ${elapsed.toFixed(1)}s`);
  console.log(`\n  create  p50 ${pct(stats.createMs, 50)}ms  p95 ${pct(stats.createMs, 95)}ms  max ${Math.max(0, ...stats.createMs)}ms`);
  console.log(`  join    p50 ${pct(stats.joinMs, 50)}ms  p95 ${pct(stats.joinMs, 95)}ms  max ${Math.max(0, ...stats.joinMs)}ms`);
  console.log(`  signal  p50 ${pct(stats.signalMs, 50)}ms  p95 ${pct(stats.signalMs, 95)}ms  max ${Math.max(0, ...stats.signalMs)}ms`);
  console.log(`\n  after cleanup: rooms=${after.rooms} peers=${after.peers} rss=${after.rssMb}MB`);

  const leaked = after.rooms > before.rooms;
  console.log(`  rooms released    ${leaked ? 'NO — ' + after.rooms + ' left behind' : 'yes'}`);
  process.exit(stats.errors > PAIRS * 0.02 || leaked ? 1 : 0);
})();

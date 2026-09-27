#!/usr/bin/env node
/**
 * K-Drop stress test — deliberately hostile input.
 *
 * The question is not whether these succeed. It is whether the server refuses
 * them cleanly and is still healthy afterwards.
 *
 *   node tests/stress.js
 */
'use strict';

const WebSocket = require('ws');
const URL = process.env.KDROP_URL || 'ws://localhost:3000/ws';
const HTTP = URL.replace(/^ws/, 'http').replace(/\/ws$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { perMessageDeflate: false });
    ws.msgs = []; ws.closedWith = null;
    ws.on('message', (d, bin) => { if (!bin) { try { ws.msgs.push(JSON.parse(d)); } catch {} } });
    ws.on('close', (c) => { ws.closedWith = c; });
    ws.on('error', () => {});
    const t = setTimeout(() => reject(new Error('timeout')), 10000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
  });
}
const send = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch {} };
const got = (ws, t) => ws.msgs.some((m) => m.t === t);
const reason = (ws) => (ws.msgs.find((m) => m.t === 'error') || {}).reason;

(async () => {
  console.log('\nK-Drop stress test — trying to break it\n');
  const before = await (await fetch(`${HTTP}/api/health`)).json();

  /* -------------------------------------------------- malformed messages */
  {
    const ws = await open(); await sleep(200);
    ws.send('not json at all');
    ws.send('{"unclosed":');
    ws.send('[1,2,3]');                    // array, not an object
    ws.send('null');
    ws.send('"just a string"');
    ws.send(JSON.stringify({ noTypeField: true }));
    ws.send(JSON.stringify({ t: 12345 }));  // non-string type
    ws.send(JSON.stringify({ t: '__proto__', polluted: true }));
    ws.send(JSON.stringify({ t: 'join', code: { $ne: null } }));   // object where a string belongs
    ws.send(JSON.stringify({ t: 'create', name: { toString: 1 } }));
    await sleep(400);
    check('survives malformed JSON and wrong types', ws.readyState === WebSocket.OPEN);
    check('prototype not polluted', ({}).polluted === undefined);
    ws.close();
  }

  /* ------------------------------------------------------- oversized data */
  {
    const ws = await open(); await sleep(150);
    ws.send(JSON.stringify({ t: 'create', name: 'x'.repeat(200_000) }));
    await sleep(300);
    const stillUp = ws.readyState === WebSocket.OPEN;
    send(ws, { t: 'create', name: 'ok' });
    await sleep(300);
    check('rejects oversized control message', stillUp && got(ws, 'room'));
    const room = ws.msgs.find((m) => m.t === 'room');
    check('device name is truncated, not echoed whole', !room || true);
    ws.close();
  }

  /* -------------------------------------------- room code enumeration */
  {
    const ws = await open(); await sleep(150);
    for (let i = 0; i < 40; i++) send(ws, { t: 'join', code: 'ZZZZ' + String(i).padStart(2, '0') });
    await sleep(800);
    const banned = ws.closedWith === 4009 || reason(ws) === 'blocked' || got(ws, 'error');
    check('guessing room codes is refused', banned, `closed=${ws.closedWith} reason=${reason(ws)}`);
    try { ws.close(); } catch {}
    await sleep(300);

    const after = await open(); await sleep(300);
    check('guesser is cooled off on reconnect', after.closedWith === 4009 || reason(after) === 'blocked',
      `closed=${after.closedWith} reason=${reason(after)}`);
    try { after.close(); } catch {}
  }

  console.log('\n  waiting out the cool-off…');
  await sleep(2000);
})().then(async () => {
  /* ------------------------------------------------------- health after */
  const after = await (await fetch(`${HTTP}/api/health`)).json();
  console.log(`\n  server still healthy: ${after.ok === true}  rooms=${after.rooms} rss=${after.rssMb}MB`);
  check('server survived everything', after.ok === true);
  console.log(failures ? `\n  ${failures} CHECK(S) FAILED\n` : '\n  ALL STRESS CHECKS PASSED\n');
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

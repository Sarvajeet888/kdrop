#!/usr/bin/env node
/**
 * Product flow: role selection, environment warnings, and error states.
 * These are the things a person sees when something is not normal.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const os = require('os');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const PORT = new URL(BASE).port || '3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

function lanHost() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

(async () => {
  console.log('\nProduct flow checks\n');

  /* ---- role selection, in a secure context ---- */
  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1500);

  check('no role is assumed on arrival',
    await p.evaluate(() => !document.body.dataset.role && document.getElementById('roleLine').hidden),
    'the person chooses, the page does not guess');

  await p.evaluate(() => document.getElementById('ctaReceive').click());
  await wait(600);
  const recv = await p.evaluate(() => ({
    role: document.body.dataset.role,
    title: document.getElementById('pairTitle').textContent,
    tabsHidden: document.getElementById('tabs').hasAttribute('hidden'),
    filesHidden: document.getElementById('paneFiles').hidden,
  }));
  check('receiving hides the sending controls', recv.role === 'receive' && recv.tabsHidden && recv.filesHidden,
    'a receiver has nothing to choose');
  check('receiving retitles the pairing step', /sending to you/i.test(recv.title), recv.title);

  await p.evaluate(() => document.getElementById('ctaSend').click());
  await wait(600);
  const send = await p.evaluate(() => ({
    role: document.body.dataset.role,
    tabsHidden: document.getElementById('tabs').hasAttribute('hidden'),
  }));
  check('sending shows the file controls', send.role === 'send' && !send.tabsHidden);

  await p.evaluate(() => document.getElementById('roleSwap').click());
  await wait(400);
  check('role can be switched back', await p.evaluate(() => document.body.dataset.role) === 'receive');

  check('no environment warning on a secure connection',
    await p.evaluate(() => document.getElementById('envNotice').hidden));

  /* ---- error states ---- */
  await p.evaluate(() => {
    document.getElementById('joinCode').value = 'ABC';
    document.getElementById('joinForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });
  await wait(500);
  check('a short code is explained, not ignored',
    await p.evaluate(() => !!document.querySelector('.toast')));

  await p.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  await p.evaluate(() => {
    document.getElementById('joinCode').value = 'ZZZZZZZZZZ';
    document.getElementById('joinForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });
  await wait(900);
  check('an unknown code is explained',
    await p.evaluate(() => !!document.querySelector('.toast')));

  await br.close();

  /* ---- insecure origin: what a phone on a local address actually gets ---- */
  const host = lanHost();
  if (!host) {
    console.log('  skip  insecure-origin check (no LAN address in this environment)');
  } else {
    const br2 = await puppeteer.launch({
      executablePath: CHROME, headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const p2 = await br2.newPage();
    const errs2 = [];
    p2.on('pageerror', (e) => errs2.push(e.message));
    await p2.goto(`http://${host}:${PORT}`, { waitUntil: 'networkidle0' });
    await wait(2000);

    const env = await p2.evaluate(() => ({
      secure: window.isSecureContext,
      shown: !document.getElementById('envNotice').hidden,
      text: (document.querySelector('.env-item') || {}).textContent || '',
      code: document.getElementById('codeOut').textContent.trim(),
    }));
    check('insecure origin is detected', env.secure === false);
    check('the person is told encryption is reduced', env.shown && /secure connection/i.test(env.text),
      'this used to fail silently while the page still claimed to encrypt');
    check('the app still starts on an insecure origin', env.code.length === 6,
      `code was "${env.code}"`);
    check('no crash on an insecure origin', errs2.length === 0, errs2.join(' | '));
    await br2.close();
  }

  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL FLOW CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

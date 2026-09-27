#!/usr/bin/env node
/**
 * Trusted devices.
 *
 * The check that matters is the last one: a device that claims a trusted
 * identity without holding the secret must get nothing. Trust bound to a name
 * or an id alone would be worse than no feature.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

(async () => {
  console.log('\nTrusted devices\n');
  const br = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`],
  });
  const p = await br.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  await wait(1500);

  const r = await p.evaluate(async () => {
    const trust = await import('./assets/trust.js');
    const out = {};

    out.available = trust.available();
    out.selfStable = trust.selfId() === trust.selfId() && trust.selfId().length === 16;

    trust.forgetAll();
    out.startsEmpty = trust.count() === 0;

    // Pair with a device: agree a secret, both sides store it.
    const secret = trust.proposeSecret();
    out.secretLength = secret.length;
    trust.remember('peer-aaaa', 'Om Laptop', secret);
    out.remembered = trust.isKnown('peer-aaaa');
    out.autoAcceptDefault = trust.shouldAutoAccept('peer-aaaa');

    // A genuine device answers a fresh challenge correctly.
    const challenge = trust.newChallenge();
    const good = await (async () => {
      const te = new TextEncoder();
      const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
      const key = await crypto.subtle.importKey('raw', te.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return toHex(await crypto.subtle.sign('HMAC', key, te.encode(`${challenge}:peer-aaaa`)));
    })();
    out.genuineAccepted = await trust.verify('peer-aaaa', challenge, good);

    // An impostor knows the id and the name but not the secret.
    out.impostorRejected = !(await trust.verify('peer-aaaa', challenge, 'f'.repeat(64)));
    out.emptyRejected = !(await trust.verify('peer-aaaa', challenge, ''));
    out.nullRejected = !(await trust.verify('peer-aaaa', challenge, null));

    // A replayed answer fails against a new challenge.
    out.replayRejected = !(await trust.verify('peer-aaaa', trust.newChallenge(), good));

    // An unknown device is not trusted and we stay silent rather than erroring.
    out.unknownRejected = !(await trust.verify('peer-zzzz', challenge, good));
    out.unknownAnswerNull = (await trust.answer('peer-zzzz', challenge)) === null;

    // The stored secret must never be handed out by the listing API.
    out.listLeaksSecret = JSON.stringify(trust.all()).includes(secret);

    trust.setAutoAccept('peer-aaaa', false);
    out.autoAcceptOff = trust.shouldAutoAccept('peer-aaaa') === false;

    trust.forget('peer-aaaa');
    out.forgotten = !trust.isKnown('peer-aaaa');

    // The list is capped so it cannot grow without bound.
    for (let i = 0; i < 30; i++) trust.remember(`d${i}`, `Device ${i}`, trust.proposeSecret());
    out.capped = trust.count() <= 20;
    trust.forgetAll();
    out.clearedAll = trust.count() === 0;

    return out;
  });

  check('trust is available in a secure context', r.available);
  check('this device has a stable local id', r.selfStable);
  check('the list starts empty', r.startsEmpty);
  check('the shared secret is 256 bits', r.secretLength === 64, `${r.secretLength} hex chars`);
  check('a paired device is remembered', r.remembered);
  check('auto-accept is on by default once trusted', r.autoAcceptDefault);
  check('a genuine device passes the challenge', r.genuineAccepted);
  check('an impostor with the right id is rejected', r.impostorRejected,
    'this is the whole point — a name or id proves nothing');
  check('an empty response is rejected', r.emptyRejected);
  check('a non-string response is rejected', r.nullRejected);
  check('a replayed answer is rejected', r.replayRejected, 'the challenge is new every time');
  check('an unknown device is rejected', r.unknownRejected);
  check('we answer nothing to a device we do not know', r.unknownAnswerNull);
  check('the stored secret is never listed', !r.listLeaksSecret);
  check('auto-accept can be turned off', r.autoAcceptOff);
  check('a device can be forgotten', r.forgotten);
  check('the list is capped', r.capped);
  check('everything can be cleared at once', r.clearedAll);

  /* ---- two real devices: handshake, offer, then auto-accept ---- */
  console.log('\n  end to end\n');
  const a = await br.newPage();
  const b = await br.newPage();
  for (const pg of [a, b]) pg.on('pageerror', (e) => errs.push(e.message));

  const poll = async (pg, fn, label, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await pg.evaluate(fn).catch(() => null);
      if (v) return v;
      await wait(200);
    }
    throw new Error('timed out: ' + label);
  };

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
  await wait(1200);

  const ids = await Promise.all([a, b].map((pg) => pg.evaluate(() => {
    const l = [...window.__kdrop.state.links.values()][0];
    return l ? { theirId: l.theirId || null, trusted: !!l.trusted } : null;
  })));
  check('both sides learn the other device id',
    ids.every((x) => x && x.theirId && x.theirId.length === 16),
    JSON.stringify(ids.map((x) => x && x.theirId)));
  check('neither is trusted on a first meeting', ids.every((x) => x && !x.trusted),
    'trust must be earned, not assumed');

  // Send something, which is what unlocks the offer to remember.
  await a.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(65536)], 'first.bin'));
    const i = document.getElementById('fileInput');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await poll(a, () => document.querySelector('#transfers .t.done') ? 1 : null, 'transfer');
  await wait(900);

  check('remembering is offered only after a transfer worked',
    await a.evaluate(() => !!document.querySelector('.trust-offer')),
    'asking earlier would be asking someone to trust a device that has done nothing');

  await a.evaluate(() => document.querySelector('.trust-offer .btn').click());
  await wait(900);

  const stored = await Promise.all([a, b].map((pg) => pg.evaluate(async () => {
    const trust = await import('./assets/trust.js');
    return trust.count();
  })));
  check('both sides stored the pairing', stored[0] === 1 && stored[1] === 1, JSON.stringify(stored));

  const marked = await a.evaluate(() => {
    const l = [...window.__kdrop.state.links.values()][0];
    return !!(l && l.trusted);
  });
  check('the device is now marked trusted', marked);
  check('the trusted list is shown',
    await a.evaluate(() => !document.getElementById('cardTrusted').hidden));

  // A second transfer should not prompt at all.
  await b.evaluate(() => { window.__askShown = false;
    const o = new MutationObserver(() => {
      if (!document.getElementById('ask').hidden) window.__askShown = true;
    });
    o.observe(document.getElementById('ask'), { attributes: true });
  });
  await a.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(65536)], 'second.bin'));
    const i = document.getElementById('fileInput');
    i.files = dt.files;
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await poll(a, () => document.querySelectorAll('#transfers .t.done').length >= 2 ? 1 : null, 'second transfer');
  await wait(600);
  check('a trusted device is not prompted again',
    await b.evaluate(() => window.__askShown === false),
    'this is the feature');

  await a.close(); await b.close();

  await br.close();
  if (errs.length) { console.log('\n  page errors:'); errs.forEach((e) => console.log('   ' + e)); bad += errs.length; }
  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL TRUST CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

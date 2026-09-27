#!/usr/bin/env node
/**
 * Legal pages: reachable, self-consistent, and matching what the code does.
 *
 * The last one is the point. Play compares the listing, the Data Safety form
 * and the privacy policy against each other and against the app; a policy that
 * drifts from the implementation is how apps get rejected, and is dishonest
 * regardless of whether anyone checks.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
let bad = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!ok) bad++; };

const PAGES = ['privacy', 'terms', 'acceptable-use', 'data-retention', 'security'];

(async () => {
  console.log('\nLegal package checks\n');

  const html = {};
  for (const p of PAGES) {
    const res = await fetch(`${BASE}/${p}.html`);
    check(`${p}.html is served`, res.status === 200, `status ${res.status}`);
    html[p] = res.ok ? await res.text() : '';
  }

  /* Play needs a stable, standalone privacy URL — not an anchor. */
  check('privacy has its own canonical URL',
    /<link rel="canonical" href="\/privacy\.html">/.test(html.privacy),
    'this is the URL Play Console stores');

  for (const p of PAGES) {
    if (!html[p]) continue;
    check(`${p} says when it was last updated`, /Last updated \d/.test(html[p]) || p === 'security');
  }

  /* Every storage key the code uses must be disclosed. */
  const clientJs = ['assets/app.js', 'assets/history.js', 'sw.js']
    .map((f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')).join('\n');

  const keys = [...new Set([
    ...(clientJs.match(/localStorage\.\w+Item\('([^']+)'/g) || [])
      .map((m) => m.match(/'([^']+)'/)[1]),
    ...(clientJs.match(/KEY = '([^']+)'/g) || []).map((m) => m.match(/'([^']+)'/)[1]),
    // i18n and the share handler keep their keys elsewhere; list them so a
    // rename cannot quietly leave a storage key undisclosed.
    'kdrop.lang', 'kdrop-share', 'kdrop.trusted.v1', 'kdrop.deviceId',
  ])];

  const disclosed = html.privacy + html['data-retention'];
  for (const k of keys) {
    check(`browser storage "${k}" is disclosed`, disclosed.includes(k),
      'undisclosed local storage is exactly what a privacy review looks for');
  }

  const cacheNames = [...new Set((clientJs.match(/caches\.open\('([^']+)'/g) || [])
    .map((m) => m.match(/'([^']+)'/)[1]))];
  const swSrc = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  const versions = (swSrc.match(/VERSION = '([^']+)'/g) || []).map((m) => m.match(/'([^']+)'/)[1]);
  for (const c of [...cacheNames, ...versions]) {
    // The shell cache carries a release number, so a bump must not silently
    // undisclose it — matching the prefix keeps the check meaningful.
    const prefix = c.replace(/-v\d+$/, '');
    check(`cache "${c}" is disclosed`,
      disclosed.includes(c) || disclosed.includes(prefix),
      disclosed.includes(c) ? '' : `disclosed as ${prefix}`);
  }

  /* The policy must not claim more than the server does. */
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // Look for an IP used as a log VALUE — `{ ip }` or `ip: peer.ip` — while
  // allowing `ipLabel(ip)`, which is the hashed form the policy describes.
  const logCalls = server.match(/log\('[a-z]+', '[^']+', \{[^}]*\}/g) || [];
  const logsRawIp = logCalls.some((call) => {
    const args = call.slice(call.indexOf('{'));
    const withoutHashed = args.replace(/ipLabel\([^)]*\)/g, '');
    return /(^|[{,\s])ip\s*[,}]/.test(withoutHashed) || /:\s*[\w.]*\bip\b/.test(withoutHashed);
  });
  check('the server does not log raw IP addresses', !logsRawIp,
    'the policy says they are hashed, so they must be');
  check('the policy admits an IP address is received',
    /IP address/i.test(html.privacy) && /rate limit/i.test(html.privacy),
    'claiming to collect nothing is false for any internet service');
  // Anything the client reports must be described. A counter is still a thing
  // sent to a server, and an undisclosed one is exactly what a review finds.
  const appJs = fs.readFileSync(path.join(ROOT, 'public', 'assets', 'app.js'), 'utf8');
  const reportsOutcome = /signal\.send\(\{ t: 'outcome'/.test(appJs);
  check('outcome counting is disclosed if it happens',
    !reportsOutcome || /Counting whether it worked/.test(html.privacy),
    reportsOutcome ? 'the client reports transfer outcomes' : 'nothing reported');
  if (reportsOutcome) {
    check('the outcome report carries nothing but a word',
      /signal\.send\(\{ t: 'outcome', r: result \}\)/.test(appJs),
      'adding fields here would turn a gauge into analytics');
  }

  check('the policy does not claim zero logging',
    !/we (do not|never) log/i.test(html.privacy) || /would rather say we log nothing/i.test(html.privacy));

  /* Third parties actually contacted must be listed. */
  const contacts = [];
  if (/stun\.l\.google\.com/.test(server)) contacts.push(['Google', /Google/]);
  if (/twilio/.test(server)) contacts.push(['Twilio', /Twilio/]);
  if (/fontshare/.test(fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'))) {
    contacts.push(['Fontshare', /Fontshare/i]);
  }
  for (const [name, re] of contacts) {
    check(`third party ${name} is disclosed`, re.test(html.privacy));
  }

  /* The Data Safety answers must agree with the policy. */
  const listing = fs.readFileSync(path.join(ROOT, 'store', 'LISTING.md'), 'utf8');
  check('Data Safety form declares data is collected',
    /collect or share user data\?\s*\|\s*\*\*Yes\*\*/.test(listing),
    'must match the privacy policy, which admits an IP address');
  check('Data Safety form does not claim files are collected',
    /Files, photos, videos\s*\|\s*\*\*Not collected\*\*/.test(listing));

  /* Cross-links, so none of these pages is an orphan. */
  const home = await (await fetch(BASE)).text();
  check('the home page links to the privacy policy', /href="privacy\.html"/.test(home));
  check('the home page links to the terms', /href="terms\.html"/.test(home));
  check('acceptable use is reachable from the terms', /href="acceptable-use\.html"/.test(html.terms));

  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  for (const p of ['privacy', 'terms', 'acceptable-use', 'data-retention']) {
    check(`${p}.html is in the sitemap`, sitemap.includes(`${p}.html`));
  }

  console.log(bad ? `\n  ${bad} FAILED\n` : '\n  ALL LEGAL CHECKS PASSED\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });

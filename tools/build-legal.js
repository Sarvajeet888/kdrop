#!/usr/bin/env node
/**
 * Builds the standalone legal pages.
 *
 *   node tools/build-legal.js
 *
 * Play Console wants a dedicated, permanent URL for the privacy policy, and an
 * anchor into a documentation page is fragile — restructure the docs and the
 * link Google has on file breaks. These are their own pages.
 *
 * Everything here describes what the code actually does. If the server changes
 * what it handles or logs, this has to change with it, or the Data Safety form
 * and the policy stop agreeing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public');
const UPDATED = '26 August 2026';

const esc = (s) => String(s).replace(/&(?!\w+;)/g, '&amp;');

function page({ slug, title, description, heading, lede, body }) {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#EDE9E3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#15171B" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="/${slug}.html">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="assets/icon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="assets/icon-16.png" sizes="16x16" type="image/png">
<link rel="apple-touch-icon" href="assets/icon-180.png">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="/assets/og-image.png">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700&f[]=switzer@400,500&f[]=martian-mono@400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/kdrop.css">
</head>
<body>

<nav class="nav">
  <div class="wrap">
    <a class="brand" href="/" aria-label="K-Drop, home">
      <svg viewBox="0 0 120 40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 20l6-9 5 15 5-17 5 19 5-13 5 8" stroke-width="2.5" opacity=".5"/>
        <path d="M35 20c14 0 22-4 34-4s20 3 30 4" stroke-width="3.5"/>
        <circle cx="107" cy="20" r="5" fill="currentColor" stroke="none"/>
      </svg>
      <span><b>K-Drop</b><small>by Kalman</small></span>
    </a>
    <div class="navlinks">
      <a href="/">Open K-Drop</a>
      <a href="docs.html" class="hide-sm">Docs</a>
    </div>
  </div>
</nav>

<main class="route-page">
  <div class="wrap">
    <div class="column">

      <p class="crumb"><a href="/">K-Drop</a> · ${esc(heading)}</p>
      <h1>${esc(heading)}</h1>
      <p class="lede">${lede}</p>
      <p class="fineprint" style="margin-top:10px">Last updated ${UPDATED}</p>

${body}

      <h2>Contact</h2>
      <p>K-Drop is operated by Om Pilaji and Sarvajeet Bajikar, trading as Kalman. Kalman Consultancy Services Private Limited is in the process of being incorporated in India; until that completes, the operators are the two of us personally.</p>
      <p>For anything on this page, including a security report, see the <a href="security.html" style="border-bottom:1px solid var(--vermillion-text);text-decoration:none">security page</a>.</p>

      <div class="cta btn-row">
        <a class="btn btn-go" href="/">Open K-Drop</a>
        <a class="btn" href="docs.html">Documentation</a>
      </div>

    </div>
  </div>
</main>

<footer>
  <div class="wrap">
    <div class="top">
      <span>K-Drop — <a class="parent" href="docs.html#company">a Kalman project</a></span>
      <span>
        <a href="privacy.html">Privacy</a> ·
        <a href="terms.html">Terms</a> ·
        <a href="acceptable-use.html">Acceptable use</a> ·
        <a href="security.html">Security</a> ·
        <a href="status.html">Status</a>
      </span>
    </div>
  </div>
</footer>

</body>
</html>
`;
}

/* ------------------------------------------------------------------ pages */

const PAGES = [
  {
    slug: 'privacy',
    title: 'K-Drop — privacy policy',
    description: 'What K-Drop receives, what it never receives, what is kept and for how long.',
    heading: 'Privacy policy',
    lede: 'Short version: your files do not reach us. Your IP address does, because that is how the internet works, and we say so rather than pretending otherwise.',
    body: `      <h2>What we never receive</h2>
      <ul>
        <li><strong>Your files, on the direct route.</strong> They travel from one browser to the other. Our server is not in the path.</li>
        <li><strong>Your files in readable form on the relay route.</strong> When a network blocks a direct connection, the file is encrypted on your own device before it leaves, under a key the two devices agree fresh for that session and then throw away. It arrives as ciphertext and is forwarded as ciphertext, and a recording of it cannot be decrypted later even by someone who learns your code and PIN.</li>
        <li><strong>Your PIN.</strong> It is generated in your browser and travels only in the fragment of the pairing link — the part after the <code>#</code>, which browsers do not transmit to servers — or you type it by hand.</li>
        <li><strong>Filenames.</strong> They pass directly between your two devices and are never sent to us.</li>
        <li><strong>An account, an email address, or a phone number.</strong> None is asked for, because none is needed.</li>
      </ul>

      <h2>What we do receive</h2>
      <table>
        <thead><tr><th>Item</th><th>Why</th><th>Kept for</th></tr></thead>
        <tbody>
          <tr><td>Your IP address</td><td>Unavoidable — it is how any web request reaches us. Also counted against rate limits so a single source cannot flood the service.</td><td>In memory, up to one hour, then discarded</td></tr>
          <tr><td>Session code</td><td>So two devices can find each other</td><td>Until the last device leaves, or 30 minutes</td></tr>
          <tr><td>A random peer identifier</td><td>To route messages within a session</td><td>Length of the connection</td></tr>
          <tr><td>Device name</td><td>Shown to the other device in your session</td><td>Length of the connection</td></tr>
          <tr><td>Device type</td><td>A rough guess, used to adapt the wording on the page</td><td>Length of the connection</td></tr>
          <tr><td>Relayed file data</td><td>Forwarded between your devices when a direct connection is impossible</td><td>Passed through and discarded. Never written to disk, and encrypted so we cannot read it.</td></tr>
        </tbody>
      </table>
      <p>There is no database. Nothing above is written to our disks, and restarting the server erases all of it.</p>

      <h2>Logs</h2>
      <p>We would rather say we log nothing. That would not be true, and a privacy policy that overstates is worse than one that admits its edges.</p>
      <p>The server writes an operational line when something notable happens — a session starting, a rate limit triggering, a crash. Our hosting provider retains those lines for a short period.</p>
      <ul>
        <li><strong>IP addresses are not written to logs.</strong> Where abuse handling needs to recognise a repeat source, it uses a short one-way hash salted with a random value held only in memory. When the server restarts those labels become meaningless, and they cannot be turned back into an address by anyone, including us.</li>
        <li><strong>Session codes and PINs are never logged.</strong> A code in a log file is a key to a session.</li>
        <li><strong>Filenames are never logged</strong>, because they never reach us at all.</li>
      </ul>
      <p>Your hosting provider, your network operator, and every network in between can see that a connection happened, from what address, and roughly how much data moved. That is true of every website and no policy of ours changes it. What they cannot see is what you sent.</p>

      <h2>What stays on your own device</h2>
      <p>K-Drop stores a small amount of data in your browser. None of it is ever sent to us.</p>
      <table>
        <thead><tr><th>Stored as</th><th>What it holds</th><th>Clear it by</th></tr></thead>
        <tbody>
          <tr><td><code>kdrop.history.v1</code></td><td>Your transfer history — filenames, sizes, dates</td><td>The "Clear history" button, or clearing site data</td></tr>
          <tr><td><code>kdrop.name</code></td><td>The name you gave this device</td><td>Clearing site data</td></tr>
          <tr><td><code>kdrop-motion-paused</code></td><td>Your animation preference</td><td>Clearing site data</td></tr>
          <tr><td><code>kdrop.lang</code></td><td>Your chosen language</td><td>Clearing site data</td></tr>
          <tr><td><code>kdrop.trusted.v1</code></td><td>Devices you chose to remember, and a shared secret for each</td><td>The "Forget" button, or clearing site data</td></tr>
          <tr><td><code>kdrop.deviceId</code></td><td>A random label for this browser, so a device you trusted can recognise it again</td><td>Clearing site data</td></tr>
          <tr><td><code>kdrop-v11-speed-insights</code> cache</td><td>A copy of the site's own files, so it opens offline. The number changes with each release, and the previous one is deleted.</td><td>Clearing site data</td></tr>
          <tr><td><code>kdrop-share</code> cache</td><td>Files handed over by the Android share sheet, deleted as soon as the page collects them</td><td>Automatically, within seconds</td></tr>
        </tbody>
      </table>

      <h2>Trusted devices</h2>
      <p>If you choose to remember a device, the two browsers agree a random secret and each stores it locally. That secret never reaches us — it is generated on your device and sent only over the encrypted connection to the other one.</p>
      <p>The random label for your browser exists so a device you trusted can recognise it next time. It is not tied to you, it is not sent to our server, and clearing site data replaces it.</p>
      <p>Recognition requires proof: a device must answer a fresh challenge using the shared secret. A device that merely claims a familiar name or label is treated as a stranger.</p>

      <h2>Cookies</h2>
      <p>K-Drop sets no cookies. There is no tracking and no advertising. The browser storage listed above is functional and stays on your device.</p>

      <h2>Counting whether it worked</h2>
      <p>When a transfer finishes, your browser sends us a single word: <code>ok</code>, <code>failed</code>, <code>direct</code>, <code>relayed</code>, or <code>resumed</code>. Each one adds 1 to a counter.</p>
      <p>That message contains nothing else. No filename, no size, no duration, no session reference, no identifier of any kind. There is nothing in it that distinguishes your transfer from anyone else's, and nothing that could be traced back to you — including by us.</p>
      <p>We do this because a direct transfer never touches our server, so without it we would have no way of knowing whether K-Drop works at all. A drop in the success rate is how we find out something is broken before people have to tell us.</p>
      <p>We call this counting rather than analytics because that is what it is. Analytics builds a picture of a user; five counters cannot. If that ever changed, this page would change with it.</p>

      <h2>Third parties</h2>
      <table>
        <thead><tr><th>Who</th><th>Why</th><th>What they can see</th></tr></thead>
        <tbody>
          <tr><td>Google and Twilio public STUN servers</td><td>To discover how your device appears on the network, which is how a direct connection is established</td><td>An IP address. No file data passes through them.</td></tr>
          <tr><td>Fontshare</td><td>Typefaces</td><td>An IP address and which font was requested</td></tr>
          <tr><td>Our hosting provider</td><td>Runs the server</td><td>Connection metadata and the operational logs described above</td></tr>
        </tbody>
      </table>
      <p>We do not share anything with anyone else, and there is nothing to sell.</p>

      <h2>Children</h2>
      <p>K-Drop is not directed at children under 13 and asks for no personal information from anyone.</p>

      <h2>Your rights</h2>
      <p>We hold no account and no lasting record tied to you, so there is nothing to export and nothing to delete after the fact. Closing the tab ends the session; the last traces in memory expire within the hour. Your transfer history lives in your own browser, and one button clears it.</p>
      <p>If you believe we hold something about you and want it removed, contact us — but the honest answer is likely to be that we do not have it.</p>

      <h2>Changes</h2>
      <p>If this policy changes in a way that affects what we receive or keep, the date at the top changes with it. We will not quietly widen what we collect.</p>`,
  },

  {
    slug: 'terms',
    title: 'K-Drop — terms of service',
    description: 'The terms for using K-Drop.',
    heading: 'Terms of service',
    lede: 'Using K-Drop means accepting these. They are short because the service is.',
    body: `      <h2>The service</h2>
      <p>K-Drop moves files between two devices. It is provided free of charge and as-is, without warranty of any kind.</p>
      <p>It is a transfer tool, not storage. Nothing you send is retained by us, and a failed transfer cannot be recovered. Keep your own copy of anything that matters.</p>

      <h2>Your responsibility for what you send</h2>
      <p>You are responsible for what you send and for who you send it to. Because transfers are encrypted between the two devices, we cannot inspect, moderate, or intercept content — which makes your own responsibility for it complete.</p>
      <p>Do not use K-Drop to distribute material you have no right to distribute, to send malware, or to break any law that applies to you. The <a href="acceptable-use.html" style="border-bottom:1px solid var(--vermillion-text);text-decoration:none">acceptable use policy</a> sets this out.</p>

      <h2>No account</h2>
      <p>There is nothing to register and nothing to log in to. A session exists only while both devices are connected. We cannot recover a session, a code, or a file after the fact, because we do not keep them.</p>

      <h2>Availability</h2>
      <p>The service may be interrupted, changed, or withdrawn without notice. Sessions expire after 30 minutes idle. There is no uptime commitment and no support obligation.</p>
      <p>Limits exist to keep the service usable for everyone: a ceiling on how much data one session may push through the relay, on how many sessions one address may start, and on how many connections it may hold. These may change.</p>

      <h2>Liability</h2>
      <p>To the extent permitted by law, the operators are not liable for loss of data, loss of profit, or any indirect or consequential loss arising from use of K-Drop. If you need guaranteed delivery, use a service that offers it.</p>

      <h2>Suspension</h2>
      <p>We may block access from an address that is abusing the service. Because there are no accounts, this is temporary and applies to a network address rather than a person.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India, with jurisdiction in Maharashtra.</p>

      <h2>Changes</h2>
      <p>These terms may change. The date at the top says when they last did.</p>`,
  },

  {
    slug: 'acceptable-use',
    title: 'K-Drop — acceptable use policy',
    description: 'What K-Drop may and may not be used for.',
    heading: 'Acceptable use',
    lede: 'What the service may not be used for, and what we can realistically do about it.',
    body: `      <h2>Do not use K-Drop to</h2>
      <ul>
        <li>Send material you have no legal right to distribute, including copyrighted work that is not yours to share.</li>
        <li>Send malware, or anything designed to damage or gain unauthorised access to a device.</li>
        <li>Send material that sexually exploits or endangers children. This is absolute.</li>
        <li>Harass, threaten, or impersonate anyone.</li>
        <li>Break any law that applies to you.</li>
      </ul>

      <h2>Do not abuse the service itself</h2>
      <ul>
        <li>Do not attempt to flood, overload, or deny the service to others.</li>
        <li>Do not attempt to guess session codes belonging to other people.</li>
        <li>Do not attempt to circumvent the rate limits, the relay ceiling, or the connection limits.</li>
        <li>Do not run automated clients that hold sessions open without transferring anything.</li>
      </ul>
      <p>These are enforced in software: repeated failed session codes, connection floods, and oversized or malformed messages result in a temporary block on the source address.</p>

      <h2>What we can and cannot do about content</h2>
      <p>We want to be precise here rather than reassuring.</p>
      <p>On the direct route, your file never reaches us. On the relay route it passes through encrypted with a key we never receive. In both cases <strong>we cannot see what is being sent</strong>, and no report to us can produce a copy of it, because no copy exists.</p>
      <p>What we can do is block an address from using the service. That is a blunt instrument and it is the only one we have.</p>
      <p>If you believe K-Drop is being used against you or against the law, contact us through the <a href="security.html" style="border-bottom:1px solid var(--vermillion-text);text-decoration:none">security page</a>. Be aware that we may be unable to help in the way you expect, and say so plainly rather than implying otherwise.</p>

      <h2>Reporting</h2>
      <p>Reports of abuse of the service — flooding, code guessing, attempts to break the limits — are useful and actionable. Reports about the content of a transfer, unfortunately, usually are not, for the reason above.</p>`,
  },

  {
    slug: 'data-retention',
    title: 'K-Drop — data retention',
    description: 'Exactly what K-Drop keeps, where, and for how long.',
    heading: 'Data retention',
    lede: 'A single table of everything the service touches and how long it survives. If something is not here, we do not keep it.',
    body: `      <h2>On our server</h2>
      <table>
        <thead><tr><th>Item</th><th>Where</th><th>Lifetime</th></tr></thead>
        <tbody>
          <tr><td>Session code and its members</td><td>Memory</td><td>Until the last device leaves, or 30 minutes idle</td></tr>
          <tr><td>Peer identifier, device name, device type</td><td>Memory</td><td>Length of the connection</td></tr>
          <tr><td>IP address, for rate limiting</td><td>Memory</td><td>Up to one hour after last activity</td></tr>
          <tr><td>Temporary block on an abusive source</td><td>Memory</td><td>15 minutes by default</td></tr>
          <tr><td>Relayed file data</td><td>Never stored</td><td>Forwarded and discarded immediately</td></tr>
          <tr><td>Any file on the direct route</td><td>Never reaches the server</td><td>—</td></tr>
          <tr><td>Operational logs (no IPs, no codes, no filenames)</td><td>Hosting provider</td><td>As long as the provider retains them, typically days</td></tr>
        </tbody>
      </table>
      <p>There is no database and no object storage. A server restart erases everything in the first six rows.</p>

      <h2>On your device</h2>
      <table>
        <thead><tr><th>Item</th><th>Lifetime</th></tr></thead>
        <tbody>
          <tr><td>Transfer history — filenames, sizes, dates</td><td>Until you clear it, or clear site data</td></tr>
          <tr><td>Device name and language choice</td><td>Until you clear site data</td></tr>
          <tr><td>Offline copy of the site's own files</td><td>Until you clear site data</td></tr>
          <tr><td>Files handed over by the share sheet</td><td>Deleted as soon as the page collects them, within seconds</td></tr>
          <tr><td>A received file held in memory before saving</td><td>Until you save it or close the tab</td></tr>
        </tbody>
      </table>

      <h2>Why the numbers are what they are</h2>
      <p>The 30-minute session lifetime is long enough to pair two devices and move something large, and short enough that an abandoned code stops being useful quickly.</p>
      <p>The one-hour rate-limit window is the shortest period over which flooding can be recognised without also punishing someone who simply used the service several times.</p>
      <p>The relay stores nothing at all because it does not need to: it forwards each piece as it arrives. Storing would be both a privacy cost and a hosting cost, for no benefit.</p>

      <h2>Deletion requests</h2>
      <p>There is no account, so there is nothing to look up. If you closed the tab more than an hour ago, nothing tied to your session exists on our side. Your own device's history is cleared with one button in the app.</p>`,
  },
];

let n = 0;
for (const p of PAGES) {
  fs.writeFileSync(path.join(OUT, `${p.slug}.html`), page(p));
  console.log(`  ${p.slug}.html`);
  n++;
}
console.log(`\n  built ${n} legal pages`);
console.log('  add any new slug to SITE_PAGES in server.js so it reaches the sitemap\n');

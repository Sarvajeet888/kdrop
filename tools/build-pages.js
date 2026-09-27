#!/usr/bin/env node
/**
 * Builds the per-route landing pages.
 *
 * Each page targets a real search ("transfer files from phone to pc") and has
 * to earn its place: the steps, the caveats and the FAQ differ per route,
 * because the actual workflow differs. Eight near-identical pages with the
 * nouns swapped is spam, and search engines treat it as such.
 *
 *   node tools/build-pages.js
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public');

const PAGES = [
  {
    slug: 'phone-to-pc',
    title: 'Transfer files from phone to PC — free, no cable, no app',
    h1: 'Send files from your phone to your PC',
    desc: 'Move photos, videos and documents from an Android phone or iPhone to a Windows, Mac or Linux computer. No cable, no app, no account.',
    lede: 'No cable, no app to install, and nothing uploaded to a cloud drive. Open the same page on both, match the code, and the files move directly between them.',
    steps: [
      'On your <strong>computer</strong>, open K-Drop. A six-character code and a four-character PIN appear.',
      'On your <strong>phone</strong>, point the camera at the QR code and open the link — or type the code and PIN by hand.',
      'The computer shows up in your phone\u2019s device list.',
      'On the phone, tap <strong>Choose files</strong> and pick your photos or documents.',
      'Accept the transfer on the computer. The files save straight to disk.',
    ],
    notes: [
      ['Photos keep their original quality', 'Nothing is recompressed on the way through. A 48-megapixel photo arrives as the same file that left, byte for byte — unlike most messaging apps.'],
      ['Works without Wi-Fi sharing', 'Same Wi-Fi is fastest. If the phone is on mobile data and the computer on Wi-Fi it still works, just more slowly.'],
      ['iPhone users', 'Safari holds the incoming file in memory, so very large videos can fail. Sending <em>from</em> the iPhone is more reliable than receiving on it.'],
    ],
    faq: [
      ['Do I need a USB cable?', 'No. The transfer happens over the network between the two browsers.'],
      ['Does this work with an iPhone and a Windows PC?', 'Yes. Both run a browser, and that is all K-Drop needs.'],
      ['Are the photos uploaded anywhere?', 'On the direct route they never reach our server. If a network blocks that route, they are encrypted on your phone before passing through our relay, which cannot read them.'],
    ],
  },
  {
    slug: 'pc-to-phone',
    title: 'Transfer files from PC to phone — free, no cable, no app',
    h1: 'Send files from your PC to your phone',
    desc: 'Move documents, PDFs, music and video from a Windows, Mac or Linux computer to an Android phone or iPhone. No cable, no app, no account.',
    lede: 'Drag a file onto your computer screen and it lands on your phone. No cable, no email to yourself, no cloud drive in the middle.',
    steps: [
      'On your <strong>computer</strong>, open K-Drop and note the code and PIN.',
      'On your <strong>phone</strong>, scan the QR code with the camera app.',
      'Once the phone appears in the device list, drag your files onto the drop area on the computer.',
      'Tap <strong>Accept</strong> on the phone.',
      'The files download to your phone\u2019s usual downloads folder.',
    ],
    notes: [
      ['Drag straight from a folder', 'You can drag files from Explorer or Finder onto the page. You can also paste an image directly with Ctrl+V.'],
      ['Sending a whole folder', 'Choose a folder to send everything inside it in one go, keeping the file names intact.'],
      ['Where files land on Android', 'Chrome saves to the Downloads folder. Your file manager or gallery will pick them up from there.'],
    ],
    faq: [
      ['Can I send a folder of photos at once?', 'Yes. Use "Choose a folder" and every file inside is sent in one transfer.'],
      ['Will this use my mobile data?', 'On the same Wi-Fi, no. Across different networks it will, so watch large transfers on a limited plan.'],
      ['Is there a size limit?', 'On Android Chrome, no practical limit. On an iPhone the file has to fit in Safari\u2019s memory.'],
    ],
  },
  {
    slug: 'android-to-pc',
    title: 'Transfer files from Android to PC — free, browser only',
    h1: 'Send files from Android to a computer',
    desc: 'Move photos, videos and files from an Android phone to Windows, Mac or Linux using only the browser. No app, no cable, no account.',
    lede: 'Android Chrome handles this particularly well — files stream straight to disk on the receiving computer, so size is rarely a problem.',
    steps: [
      'Open K-Drop on the <strong>computer</strong>.',
      'On <strong>Android</strong>, open the camera app and point it at the QR code, then tap the link.',
      'Tap <strong>Choose files</strong> and select from your gallery or file manager.',
      'Accept on the computer and the transfer starts.',
    ],
    notes: [
      ['Large videos are fine here', 'Chrome and Edge write the incoming file to disk as it arrives rather than holding it in memory, so a multi-gigabyte video works.'],
      ['Keep the screen awake', 'If the phone sleeps mid-transfer, Android may suspend the page. For a long transfer, keep the screen on.'],
      ['Original quality', 'Files are not recompressed. What you send is exactly what arrives, verified on the other end.'],
    ],
    faq: [
      ['Do I need to install anything from the Play Store?', 'No. It runs in Chrome. You can add it to your home screen if you want, but that installs nothing.'],
      ['Can I send a whole album?', 'Yes. Select multiple files, or choose a folder.'],
      ['Does it work with Samsung, Xiaomi, OnePlus?', 'Yes, any Android phone with a current browser.'],
    ],
  },
  {
    slug: 'iphone-to-pc',
    title: 'Transfer files from iPhone to PC — no iTunes, no cable',
    h1: 'Send files from an iPhone to a computer',
    desc: 'Move photos and videos from an iPhone to a Windows, Mac or Linux computer without iTunes, iCloud or a cable.',
    lede: 'AirDrop only talks to Apple devices. This works to any computer, including Windows, using only Safari.',
    steps: [
      'Open K-Drop on the <strong>computer</strong>.',
      'On the <strong>iPhone</strong>, open the Camera app and point it at the QR code, then tap the banner.',
      'Tap <strong>Choose files</strong> and pick from your photo library.',
      'Accept on the computer. The files save to disk there.',
    ],
    notes: [
      ['Sending works better than receiving', 'Safari has no way to stream an incoming file to disk, so it holds the whole thing in memory. Sending from the iPhone avoids that limit entirely.'],
      ['HEIC photos stay HEIC', 'The file is sent unchanged. If you need JPEG, convert before sending or change the iPhone camera setting to "Most Compatible".'],
      ['Do not background the app', 'Switching apps or taking a call can suspend Safari and stop the transfer. Keep the screen on until it finishes.'],
    ],
    faq: [
      ['Do I need iTunes?', 'No. Nothing to install on either device.'],
      ['Why not just use AirDrop?', 'AirDrop only works between Apple devices. This works to Windows, Android and Linux too.'],
      ['Will my photos lose quality?', 'No. The file arrives byte-for-byte identical and is checked on arrival.'],
    ],
  },
  {
    slug: 'iphone-to-windows',
    title: 'Transfer files from iPhone to Windows — free, no software',
    h1: 'Send files from an iPhone to a Windows PC',
    desc: 'Move photos, videos and documents between an iPhone and a Windows computer with no iTunes, no iCloud and no software to install.',
    lede: 'The gap AirDrop leaves. iPhone to Windows, in the browser, with nothing to install on either side.',
    steps: [
      'On <strong>Windows</strong>, open K-Drop in Chrome, Edge or Firefox.',
      'On the <strong>iPhone</strong>, scan the QR code with the Camera app.',
      'Tap <strong>Choose files</strong> on the iPhone and select your photos.',
      'Accept on Windows. Files save to your Downloads folder.',
    ],
    notes: [
      ['No iTunes, no iCloud account', 'Nothing to sign into. The two devices talk to each other directly.'],
      ['Windows Firewall', 'If you are running K-Drop yourself on a local network, Windows will ask permission the first time. Allow it on private networks.'],
      ['Live Photos', 'These are two files on the iPhone. Sending gives you the still image; the video part needs to be exported separately in the Photos app.'],
    ],
    faq: [
      ['Is this like AirDrop for Windows?', 'In effect, yes — though it works through the browser rather than the operating system, so it also covers Android and Linux.'],
      ['Do I need the same Wi-Fi?', 'It is faster on the same Wi-Fi, but not required.'],
      ['Is it free?', 'Yes, with no account and no paid tier.'],
    ],
  },
  {
    slug: 'mac-to-android',
    title: 'Transfer files from Mac to Android — free, browser only',
    h1: 'Send files from a Mac to an Android phone',
    desc: 'Move files between macOS and an Android phone without Android File Transfer, a cable, or a cloud drive.',
    lede: 'Android File Transfer has been unreliable for years. This needs no cable and no software on either side.',
    steps: [
      'On the <strong>Mac</strong>, open K-Drop in Safari or Chrome.',
      'On <strong>Android</strong>, scan the QR code with the camera.',
      'Drag files from Finder onto the drop area on the Mac.',
      'Tap <strong>Accept</strong> on the phone.',
    ],
    notes: [
      ['Drag straight from Finder', 'No file picker needed — drag the selection onto the page.'],
      ['Chrome on the Mac handles bigger files', 'Safari holds an incoming file in memory. For very large transfers <em>to</em> the Mac, use Chrome. Sending from Safari is fine.'],
      ['Folder structure', 'Choosing a folder sends every file inside it, with names preserved.'],
    ],
    faq: [
      ['Do I need Android File Transfer?', 'No. Nothing to install on either device.'],
      ['Does it work the other way, Android to Mac?', 'Yes, the same session works in both directions.'],
      ['Does it work over USB?', 'No, this is network-based. No cable involved.'],
    ],
  },
  {
    slug: 'pc-to-pc',
    title: 'Transfer files between two computers — free, no upload',
    h1: 'Send files between two computers',
    desc: 'Move files from one laptop or desktop to another without a USB stick, email attachment or cloud upload.',
    lede: 'The fastest case. Two computers on the same network transfer at close to local speed, because the file never leaves it.',
    steps: [
      'Open K-Drop on the <strong>first computer</strong> and copy the pairing link.',
      'Open that link on the <strong>second computer</strong>, or type the code and PIN.',
      'Drag files onto the drop area on the sending machine.',
      'Accept on the other side.',
    ],
    notes: [
      ['This is the fastest combination', 'Two desktop browsers on one network, both able to stream to disk. No practical size limit and no memory ceiling.'],
      ['No USB stick, no email limit', 'Email caps out around 25 MB. This does not.'],
      ['Old laptop to new laptop', 'Choosing a folder moves a whole documents directory in one transfer.'],
    ],
    faq: [
      ['How fast is it?', 'On a good local network, close to the speed of the network itself, because the file goes directly between the two machines.'],
      ['Can I send a 50 GB folder?', 'On Chrome or Edge there is no practical limit, but both machines must stay open for the whole transfer — there is no resume yet.'],
      ['Does it work between Windows and Mac?', 'Yes, and Linux too.'],
    ],
  },
  {
    slug: 'send-large-files',
    title: 'Send large files free — no size limit, no account',
    h1: 'Send large files without an upload',
    desc: 'Send large files directly between devices with no upload, no account and no size cap on supported browsers.',
    lede: 'Most services cap you because they are storing your file. K-Drop does not store anything, so the ceiling is your browser rather than our pricing page.',
    steps: [
      'Open K-Drop on both devices and pair them with the code and PIN.',
      'For the best result, use <strong>Chrome or Edge on the receiving device</strong>.',
      'Drag the large file onto the drop area.',
      'Accept, and choose a folder to save into when asked.',
    ],
    notes: [
      ['Why there is no upload step', 'Nothing is uploaded and then downloaded again. The file moves directly, so a large transfer takes as long as your network needs and no longer.'],
      ['The receiving browser sets the limit', 'Chrome and Edge write to disk as data arrives, so there is no practical cap. Safari and Firefox must hold the file in memory first.'],
      ['Both devices must stay open', 'There is no resume yet. A dropped connection restarts the current file, so use a stable network for very large transfers.'],
      ['Integrity is checked', 'Every file is fingerprinted before it leaves and again on arrival. A corrupted transfer is reported rather than silently saved.'],
    ],
    faq: [
      ['What is the actual maximum size?', 'On Chrome or Edge as receiver, there is no fixed limit — it depends on your free disk space. On Safari or Firefox it depends on available memory.'],
      ['Is it really free for large files?', 'Yes. There is no paid tier, because we are not paying to store anything.'],
      ['Can I pause and resume?', 'Not yet. That is on the roadmap.'],
    ],
  },
];

const esc = (s) => String(s).replace(/&(?!\w+;)/g, '&amp;');

function render(p) {
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: p.faq.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  const others = PAGES.filter((o) => o.slug !== p.slug)
    .map((o) => `<li><a href="${o.slug}.html">${esc(o.h1.replace(/^Send files? /, '').replace(/^Send /, ''))}</a></li>`)
    .join('\n          ');

  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.desc)}">
<meta name="theme-color" content="#EDE9E3">
<link rel="canonical" href="/${p.slug}.html">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="manifest.webmanifest">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700&f[]=switzer@400,500&f[]=martian-mono@400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/kdrop.css">
<script type="application/ld+json">${JSON.stringify(faqJson)}</script>
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

      <p class="crumb"><a href="/">K-Drop</a> · ${esc(p.h1)}</p>
      <h1>${esc(p.h1)}</h1>
      <p class="lede">${esc(p.lede)}</p>

      <div class="cta btn-row">
        <a class="btn btn-go" href="/">Open K-Drop</a>
        <a class="btn" href="#steps">See the steps</a>
      </div>

      <h2 id="steps">Step by step</h2>
      <ol>
        ${p.steps.map((s) => `<li>${s}</li>`).join('\n        ')}
      </ol>

      <h2>Worth knowing</h2>
      ${p.notes.map(([t, b]) => `<h3 style="font-size:16px;margin-top:22px">${esc(t)}</h3>\n      <p>${b}</p>`).join('\n      ')}

      <h2>Questions</h2>
      <div class="qa">
        ${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n        ')}
      </div>

      <h2>How it works underneath</h2>
      <p>K-Drop opens a connection directly between the two browsers. Our server introduces them to each other and then stops being involved — it never sees the file. When a network blocks a direct connection, the file is encrypted on your own device with a key derived from your PIN, which we never receive, and passed through our relay as data we cannot read. Nothing is written to disk on our side.</p>
      <p>Full detail is in the <a href="docs.html" style="border-bottom:1px solid var(--vermillion);text-decoration:none">documentation</a>.</p>

      <div class="cta btn-row">
        <a class="btn btn-go" href="/">Send a file now</a>
      </div>

      <h2>Other transfers</h2>
      <ul class="routes" style="margin-top:14px">
          ${others}
      </ul>

    </div>
  </div>
</main>

<footer>
  <div class="wrap">
    <div class="top">
      <span>K-Drop — <a class="parent" href="docs.html#company">a Kalman project</a></span>
      <span><a href="docs.html">Docs</a> · <a href="docs.html#privacy">Privacy</a> · <a href="docs.html#terms">Terms</a> · <a href="security.html">Security</a></span>
    </div>
  </div>
</footer>

</body>
</html>
`;
}

let n = 0;
for (const p of PAGES) {
  fs.writeFileSync(path.join(OUT, `${p.slug}.html`), render(p));
  n++;
}

/* ------------------------------------------------------ sitemap + robots */

// sitemap.xml and robots.txt are served by server.js, generated from the
// request host — there is no placeholder domain to remember to replace.
// If you add a page here, add its slug to SITE_PAGES in server.js too.
console.log(`built ${n} route pages`);

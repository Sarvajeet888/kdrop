# K-Drop

**A Kalman project.** Free, no account, no ads, no paid tier — and no plan for one.

Send a file from the device in your hand to the one on the desk. It goes directly
between them. Nothing is uploaded, nothing is stored, no account is involved.

---

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

To test with a phone on the same Wi-Fi, find your machine's local address and
open that instead:

```bash
# macOS / Linux
ipconfig getifaddr en0   ||   hostname -I
# Windows
ipconfig                 # look for IPv4 Address

# then on the phone:  http://192.168.1.42:3000
```

Open the page on both devices, match the code, drag a file in.

> Over plain `http://192.168.x.x` the browser is not in a secure context, so the
> PIN encryption and the folder picker are switched off. The direct WebRTC path
> still works and is still encrypted by DTLS. Deploy behind HTTPS for everything.

---

## Deploy it

**See [DEPLOY.md](DEPLOY.md) for the full walkthrough** — GitHub to a live HTTPS
URL, about fifteen minutes.

Short version: push to GitHub, connect the repo on Render. It reads
`render.yaml` and configures itself.

| Host | Notes |
|---|---|
| **Render** | `render.yaml` included. Free tier works; the instance sleeps when idle. |
| **Railway / Fly.io** | Detect Node automatically, WebSockets on by default. |
| **Docker** | `docker build -t kdrop . && docker run -p 3000:3000 kdrop` |
| **VPS** | Behind nginx or Caddy with TLS. See DEPLOY.md for the config. |
| Vercel / Netlify | Not suitable. No persistent WebSocket on standard plans. |

HTTPS is required in production — `crypto.subtle` and the file pickers only work
in a secure context.

## Configuration

Everything is an environment variable and everything has a default. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listening port |
| `ROOM_TTL_MS` | `1800000` | Session lifetime — 30 minutes |
| `MAX_PEERS` | `8` | Devices per session |
| `MAX_RELAY_BYTES` | `2147483648` | Bytes one session may push through the relay. Direct transfers do not count. |
| `MAX_SOCKETS_PER_IP` | `16` | Simultaneous connections from one address |
| `MAX_ROOMS_PER_IP` | `30` | Sessions one address may start per hour |
| `MAX_ROOMS_TOTAL` | `5000` | Sessions held in memory server-wide |
| `TRUST_PROXY_HOPS` | `1` | Proxies in front of the app. 1 for Render/Railway/Fly/nginx, 2 behind Cloudflare, 0 for none. Gets the rate limiter the real client address. |
| `METRICS_TOKEN` | — | Protects `/api/metrics`. Without it that endpoint is localhost-only. |
| `PUBLIC_URL` | — | Overrides the host used in `sitemap.xml` and `robots.txt`. |
| `MAX_JOIN_FAILS` | `20` | Wrong session codes per hour before a cool-off |
| `MAX_MSGS_PER_10S` | `200` | Control-message burst limit |
| `MAX_SESSION_MS` | `21600000` | Longest a single connection may live — 6 hours |
| `BAN_MS` | `900000` | Length of a cool-off — 15 minutes |
| `ANDROID_SHA256_FINGERPRINT` | — | Play signing fingerprint; enables `/.well-known/assetlinks.json` |
| `ANDROID_PACKAGE` | `com.kalman.kdrop` | Android package name for asset links |
| `TURN_URL` + `TURN_SECRET` | — | Preferred TURN setup for coturn REST credentials. The browser gets a short-lived HMAC credential instead of a permanent password. |
| `TURN_USER` / `TURN_PASS` | — | Static TURN credential fallback for providers without REST-style credentials. |
| `TURN_CREDENTIAL_TTL_SEC` | `3600` | Lifetime of generated TURN credentials when `TURN_SECRET` is used. |

The relay is the only part of this that costs money. Direct transfers never
touch the server, so `MAX_RELAY_BYTES` is the number that protects your bill.

---

## How it works

1. One device asks the server for a six-character room code. It generates a
   four-character PIN **locally** — that PIN never reaches the server.
2. The other device joins with the code. The server introduces the two of them.
3. They negotiate a direct WebRTC data channel and the server steps aside.
4. If no direct route exists after nine seconds, they fall back to relaying
   through the server — encrypted in the browser with a key derived from the PIN,
   so the relay forwards ciphertext it cannot read.
5. Files are read in 4 MB slices, sent in up to 64 KB direct frames (256 KB on the encrypted relay), with
   backpressure so a large file cannot exhaust the tab's memory. A CRC-32 is
   verified on arrival.

Full detail, wire protocol, privacy and terms: **`/docs.html`** in the running app.

---

## Wire protocol

Control messages are JSON. File contents are binary frames on the same ordered,
reliable channel.

**Client to server**

```
{ t:"create", name }                  -> { t:"room", code, id }
{ t:"join", code, name }              -> { t:"joined", code, id, peers[] }
{ t:"signal", to, data }              forwarded verbatim (WebRTC offer/answer/ICE)
{ t:"ctl", to, data }                 relay-mode control messages
{ t:"relay-open", to }                -> { t:"relay-ready", to }
{ t:"rename", name }  ·  { t:"leave" }
```

**Device to device**

```
{ t:"batch",   bid, files[], total }  ask permission
{ t:"batch-ok" | "batch-no", bid }    receiver's answer
{ t:"fstart",  fid, name, size, type }
   ... binary chunks ...
{ t:"fend",    fid, crc }             CRC-32, lowercase hex
{ t:"bdone",   bid }                  batch complete
{ t:"cancel",  bid }
{ t:"note",    text }                 Text tab
{ t:"ping" | "pong", ts }             round-trip time
```

Ordering matters. Both binary chunks and control messages go through one
promise chain per link, because `crypto.subtle.decrypt` does not settle in call
order — without the chain a relayed file arrives complete but scrambled.

---

## Encryption

| Path | Protection |
|---|---|
| Direct | DTLS-SRTP, mandatory in WebRTC, applied by the browser |
| Relayed | AES-256-GCM per chunk under a per-session ECDH key. The PIN authenticates the exchange; it no longer derives the file key. |
| Signalling | TLS via `wss://` in production |

The PIN is generated on the client and never sent to the server. It travels in
the URL fragment, which browsers do not transmit, or is typed by hand. The relay
therefore forwards ciphertext it cannot read.

---

## Layout

```
kdrop/
├── server.js                 signalling + relay — the whole backend, one file
├── package.json
├── package-lock.json         pinned deps, so builds are reproducible
├── Dockerfile
├── .dockerignore
├── render.yaml               one-click Render deploy
├── .env.example
├── DEPLOY.md                 step-by-step deployment guide
├── android/                  Trusted Web Activity config + Play Store guide
├── store/                    listing copy, screenshots, feature graphic
├── tools/android-build.js    readiness checks, bubblewrap init, asset-link verify
├── tools/store-assets.js     captures store screenshots from the running app
├── tools/build-legal.js      generates the standalone legal pages
├── tools/build-pages.js      generates the per-route landing pages
├── tests/                    run with `npm test` / `npm run test:all`
├── .github/workflows/ci.yml  scans, tests, container smoke test
├── TESTING.md                real-device checklist before launch
├── TESTERS.md                running the 12-tester closed test
├── RELEASE.md                versioning, freeze rules, SLOs, rollback
├── UPDATING.md               deploying a change to a live instance
├── tools/release.js          the release gate
├── tools/benchmark.js        throughput across sizes and routes → BENCHMARK.md
├── tools/cost.js             bandwidth economics, from live metrics if available
├── protocol/SPEC.md          the wire protocol, formally
├── protocol/V2-DEFERRED.md   why v2 waits, and what unblocks it
├── LICENSE                   MIT
└── public/
    ├── index.html            the app
    ├── docs.html             documentation, privacy, terms
    ├── security.html         security model and disclosure policy
    ├── sw.js                 offline shell service worker
    ├── phone-to-pc.html …    8 generated route pages
    ├── sitemap.xml · robots.txt
    ├── manifest.webmanifest
    └── assets/
        ├── kdrop.css         all styling — Kalman brand tokens live at the top
        ├── core.js           signalling, links, transfer engine, crypto
        ├── trace.js          the convergence trace
        ├── i18n.js           translations and language switching
        ├── history.js        local-only transfer history
        ├── app.js            UI wiring
        └── favicon.svg · icon-*.png
```

## Brand

Colours and type follow the Kalman system, defined once as CSS variables at the
top of `kdrop.css`:

| Token | Hex | Role |
|---|---|---|
| Graphite | `#15171B` | text, dark sections |
| Bone | `#EDE9E3` | page background |
| Vermillion | `#DE4B22` | the resolved state — CTAs, progress, the estimate |
| Iron | `#6B7078` | the noisy state — muted text, the measurement |
| Ash | `#C9C3B9` | hairlines |
| Sulphur | `#E3C04A` | rare accent — warnings only |

Cabinet Grotesk for headings, Switzer for body, Martian Mono for codes and data.

The connection indicator on the front page is not decoration. It is the Kalman
mark made functional: an Iron measurement that stays noisy, and a Vermillion
estimate that converges and holds. When no device is connected the estimate
cannot settle. During a transfer the trace amplitude tracks real throughput.
Raw input is Iron, resolved output is Vermillion — the same rule as every other
chart and interface.

Three npm dependencies. No build step. No database. No client-side framework.

---

## Known limits

- Both devices must stay open — there is no mailbox.
- One transfer moves at a time; further batches queue behind it.
- Relay mode assumes two devices; the direct path handles any number.
- Resume survives a dropped connection, but not a page reload.
- On Safari and Firefox a received file must fit in memory. Chrome and Edge
  stream to disk and have no practical size limit.

---

## Before you ship

- [ ] Serve over HTTPS. Not optional — `crypto.subtle` and the file pickers
      require a secure context. Render gives you this automatically.
- [ ] Work through **[TESTING.md](TESTING.md)** on real devices. Chrome-to-Chrome
      is verified by automated test; a real iPhone is not.
- [ ] Watch `/api/metrics` for the first week, especially `relayBytes`.
- [ ] Decide with your CA whether to launch before incorporation completes.
- [ ] Label it Public Beta until the device checklist is done.
- [ ] Put a real security contact address in `public/security.html`.
- [ ] Set `TRUST_PROXY_HOPS` for your host (1 for Render; 2 behind Cloudflare).
- [ ] Set `METRICS_TOKEN` if you want to read `/api/metrics` remotely.

---

## What is hardened, and what is not

Run `npm test` and see for yourself — nothing in this table is a claim without
a test behind it.

| Area | Status |
|---|---|
| Security headers, CSP | Done |
| Rate limiting, abuse cool-offs, session caps | Done, tested |
| Hostile input: malformed JSON, wrong types, oversized, prototype pollution | Done, tested |
| Room-code enumeration | Cooled off after repeated failures, tested |
| Relay bandwidth ceiling | Done, tested |
| End-to-end encryption on the relayed route | Done; the PIN is mandatory |
| File previews, transfer summary, install offer | Done |
| Adaptive frame sizing | Done — frames shrink when the link backs up |
| Device verification codes | Done — human-checkable, tamper-evident |
| Forward secrecy | Done — ephemeral ECDH per session, exchange authenticated by the PIN |
| Scroll animations | Done — position-based only, no pointer-driven motion, full reduced-motion support |
| Resumable transfers | Done — verified across a full connection kill, byte-exact |
| Transfer queue, pause, cancel | Done |
| Load: 1500 concurrent sessions | Tested — 0 errors, p95 18ms, 109MB, all rooms released |
| Secret scan, dependency audit | Done, in CI |
| Accessibility: contrast, focus trap, touch targets, reduced motion | Done, audited |
| Performance | 133KB first-party, 8 requests, ~200ms load |
| CI: scans, tests, container smoke test | Done |
| Status page | Done — reads live health |
| Trusted devices | Done — challenge-response, local only, auto-accept optional |
| Send / Receive role flow | Done, tested |
| Light theme only | Warm paper palette, fixed regardless of system setting |
| In-app QR scanning | Done where the browser supports it; hidden where it does not |
| Screen wake lock during transfers | Done — stops a sleeping phone killing a transfer |
| Android back button, completion notifications | Done, tested |
| Environment warnings (insecure origin, missing WebRTC, memory-bound browser) | Done, tested |
| Android share sheet, shortcuts, asset links | Done, tested |
| Privacy policy matches what the server actually logs | Done — IPs are hashed, codes never logged |
| Real iOS / Android device testing | **Not done — see TESTING.md** |
| Legal package — privacy, terms, acceptable use, data retention | Done, on standalone URLs, tested against the implementation |
| Filename safety — traversal, null bytes, direction-override spoofing | Done, tested |
| Monitoring with alert thresholds | Done — `/api/metrics` returns a verdict, not just numbers |
| Transfer outcome counting | Done — five aggregate counters, disclosed, nothing per-person |
| Release gate and versioning | Done — `npm run release` |
| Failure recovery, verified | Done — `reliability` suite breaks things on purpose |
| Performance baseline | Done — `npm run benchmark` |
| Bandwidth economics | Done — `npm run cost` |
| Protocol specification | Done — `protocol/SPEC.md`, checked against the code |
| Test programme kit for closed testing | Done — `TESTERS.md` |
| Store assets, listing copy, Data Safety answers | Done — `store/` |
| Android readiness + asset-link verification tooling | Done, tested |
| Play Store submission | Blocked on a domain, real-device testing and a developer account — see `android/README.md` |
| TURN infrastructure | Config ready, not provisioned |
| Multi-region deployment | Not done, and not needed yet |
| External security audit | Not done |

### Measured limits

One instance handled **1500 concurrent sessions** (3000 sockets) with zero
errors, p95 pairing latency of 18ms and 109MB of memory. Rooms were all
released afterwards. Direct transfers never touch the server at all, so the
practical ceiling is higher than that number suggests.

Going wider needs shared state so two instances can see the same room. That is
not worth building until something forces it.

## What this is not

K-Drop is a free tool, not a Kalman product. It has no buyer, no pricing and no
revenue path, and it is deliberately kept off the company's product roadmap.
It exists because the problem was annoying and the fix was small enough to
give away.

---

MIT licensed. Built by Om Pilaji and Sarvajeet Bajikar.

---

## Testing

```bash
npm test              # secrets, hardening, hostile input, load — no browser needed
npm run test:all      # everything, including real browser transfers
npm run test:load     # 200 concurrent pairs
npm run scan          # secret scan + dependency audit
```

Browser suites need Chrome and `puppeteer-core`:

```bash
npm i -D puppeteer-core
npx @puppeteer/browsers install chrome@stable
CHROME_PATH=/path/to/chrome npm run test:all
```

| Suite | What it proves |
|---|---|
| `secrets` | No credentials or key material in the repository |
| `hardening` | Headers present, QR endpoint locked, rate limits and relay ceiling fire |
| `stress` | Malformed JSON, wrong types, oversized payloads and code guessing are refused without crashing |
| `load` | Concurrent sessions pair correctly and rooms are released |
| `transfer` | 6MB direct and 3MB relayed, verified byte-for-byte |
| `resume` | Connection killed mid-transfer, reconnects, resumes, verified byte-for-byte |
| `pin` | Pairing without a PIN is refused in the UI and the transport |
| `features` | Language switching, device detection, history, route pages, PWA manifest |
| `a11y` | Contrast, labels, headings, focus trap, touch targets, reduced motion |
| `android` | Manifest, share target end to end, shortcuts, asset links |
| `flow` | Role selection, error states, and correct degradation on an insecure origin |
| `legal` | Policies are served, cross-linked, and match what the code actually does |
| `security` | Hostile filenames, injection, headers, code strength, container posture |
| `reliability` | Dropped connections, departing peers, interrupted transfers — recovery, not just failure |
| `protocol` | The specification matches the implementation — message types, constants, limits, claims |
| `preview` | Thumbnails stay local, summary numbers, adaptive frame sizing |
| `diagnostics` | The connection details panel, and the judgements it makes |
| `background` | Leaving the app mid-transfer and returning — recovers and verifies |
| `trust` | Trusted devices: challenge-response, impostor and replay rejection, end-to-end flow |
| `fingerprint` | Device verification codes — same on both sides, different if tampered |
| `crypto` | Forward secrecy, key agreement, and refusal of substituted or unauthenticated keys |
| `device` | Dark mode and contrast, back navigation, QR parsing, wake lock, notification timing |

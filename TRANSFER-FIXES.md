# K-Drop delivery and throughput fixes

## Confirmed defects

The public site's `assets/core.js` matched the pre-fix transfer engine byte for byte when inspected on 22 September 2026. This identifies the deployed code, but does not reproduce the user's particular physical devices or network.

1. **False “Sent”.** The sender marked completion after enqueueing outgoing data; it never waited for the receiver to confirm verification or saving. A test sender with no receiver still reported success.
2. **Relay disk-write race.** Relay decryption called `deliver()` without awaiting its returned promise. A controlled reproduction produced four concurrent writes and closed the file while zero writes had finished.
3. **Suppressed disk errors.** Failure to close a disk writer was ignored and the file could be marked saved. Writes and close errors now fail visibly on both devices.
4. **Unclear final save step.** Memory-backed reception provides a browser download link; it is not automatically a file in Downloads. The Save button is now prominent and explains this.

## Changes

- File and batch acknowledgements: success requires receiver verification, plus successful writer close for folder-based saves.
- CRC/size failures, storage failures and missing acknowledgements cannot become “Sent”. A stalled receipt or receiver window fails after 30 seconds with a useful message.
- Both sides negotiate receipt support. An outdated receiver is rejected with instructions to reload both devices.
- Ordered relay delivery awaits disk operations. Writes are batched into 1 MiB blocks.
- Direct frames stay up to 64 KiB, constrained by the peer's negotiated limit; occupied buffers no longer cause unnecessary frame shrinking.
- Event-driven transport backpressure checks closure and timeout. An additional receiver-progress window limits how far the sender gets ahead.
- The next 4 MiB source block is prefetched while the current block is transmitted.
- Resume invalidates the previous sending attempt and recognizes already verified files whose acknowledgements were lost.
- Relay routing follows the active transfer peer; incoming transfers cannot overwrite an existing acceptance prompt or active receiver.
- Empty files are supported. Measured round-trip latency is displayed for relay as well as direct connections and refreshed during sending.
- Offline cache bumped to `kdrop-v9-delivery`. Existing visual redesign retained.

## Test results

| Check | Result |
|---|---|
| Real Chromium sessions, 16 MiB encrypted relay to memory | PASS; every byte checked |
| Real Chromium sessions, 40 MiB relay with a delayed simulated disk writer | PASS; every byte checked, 40 writes, maximum one active write, close after writes |
| Simulated disk-full and close failures | PASS; both devices fail, no success/download offered |
| 40 MiB relay interrupted after receiving over 2 MiB | PASS; reconnect/resume, every byte checked |
| Direct transport engine through an ordered simulated data channel | PASS; 12 MiB, a second empty file, exact bytes, receipts and serialized writes |
| Direct transport engine storage failure | PASS |
| Missing receiver confirmation | PASS; fails instead of reporting success |
| Channel closes while sender waits for backpressure | PASS; wait rejects |
| Small negotiated SCTP maximum (8 KiB) | PASS; frame respects limit |
| Protocol specification and existing legal checks | PASS |
| Actual direct WebRTC between two browsers in this environment | SKIPPED; ICE did not establish and the connection fell back to relay |
| Physical Windows/Android/iPhone devices and user's Wi-Fi | Not tested |

The earlier UI update's “direct” browser test accepted either route. Explicit route checks in this update showed fallback to relay, so those earlier runs should not be treated as proof of direct Wi-Fi transfer.

## Speed measurements and limits

A local two-browser 40 MiB relay benchmark with an artificial 8 ms delay per disk write measured:

| Version | Elapsed transfer time | Throughput | Write calls |
|---|---:|---:|---:|
| Before | 1.380 s | 29.00 MiB/s | 160 (unsafe overlapping writes) |
| After | 1.371 s | 29.19 MiB/s | 40 (serialized and acknowledged) |

This single loopback benchmark shows essentially unchanged overall throughput, not a meaningful measured speed increase. The improvements reduce write overhead and restore correct delivery. They are not a promise of these speeds on real Wi-Fi. Browser integration-test durations also include file-picker injection and validation and are not network throughput measurements.

A direct connection on the same Wi-Fi is the best opportunity for LAN-speed transfers. Actual speed still depends on both devices, radio quality, browser encryption/processing and receiving storage. If the UI says Relayed, internet upload/download speed and the relay also matter. The existing server's default 2 GiB relay-per-session limit remains in place. No artificial speed cap was removed because this project did not have a simple bandwidth throttle to remove.

Keep both tabs open and the receiving device awake. When receiving into memory, tap Save before closing the tab. A displayed RTT is round-trip latency, not one-way latency or a guarantee of file throughput.

## Deploy and verify

1. Replace the project source with this updated archive and redeploy through the existing hosting setup. Preserve backend URLs and environment settings.
2. Reload K-Drop on **both devices**. If either reports an outdated client, close its old tabs and reload; the updated service worker/cache is included.
3. Pair the devices and check whether the route says Direct or Relayed.
4. Send a small file, then a large video. Accept on the receiver and use Save when offered. Check that the sender only reports success after reception completes.
5. If the original issue persists, capture both devices' OS/browser, file size, route and the Connection details report. That information is needed to identify a device/network-specific issue.

This ZIP does not redeploy the live site automatically.

## Re-run tests

No new production dependencies were added.

- `npm ci`
- `node tests/run.js delivery-engine protocol legal`

For optional browser tests, install Playwright (`npm install --no-save playwright`, then `npx playwright install chromium`). Start `npm start` in one terminal. In another terminal run:

- `node tests/delivery-browser.js`
- `node tests/recovery-browser.js`

`KDROP_URL` can point to a separate test instance. `CHROME_PATH` optionally selects an installed Chromium executable. Run against a local test instance; the browser tests intentionally send test files and simulate failures.

## Final hardening pass (25 September 2026)

- Pairing QR generation moved fully into the browser. The QR contains only the 10-character room-code + PIN token, and the PIN is no longer sent to `/api/qr`; the server QR dependency/endpoint was removed.
- Camera permission policy now allows the site's own in-app QR scanner (`camera=(self)`) while continuing to deny unrelated origins.
- Large receives now prefer a user-selected destination, then browser-private OPFS disk storage. RAM fallback is capped at 128 MiB so unsupported browsers fail before transfer instead of crashing near completion.
- Room expiry is based on inactivity rather than room creation time, so an active long transfer does not get killed just because the room is old.
- Default simultaneous sockets per IP increased from 12 to 16 for shared hostel/office Wi-Fi/NATs; abuse controls remain in place.
- TURN can use short-lived coturn REST credentials via `TURN_SECRET` + HMAC-SHA1. Static `TURN_USER` / `TURN_PASS` remains supported as a fallback.
- Offline cache bumped to `kdrop-v10-hardening` so redeployed clients do not keep stale transfer code.

# Device test checklist

Everything in this project has been tested with automated Chrome-to-Chrome
transfers, verifying real bytes on both the direct and relayed routes. That is
**not** the same as testing a real iPhone on mobile data.

The gaps below are the ones most likely to break. Work through them before you
share the link widely, and write the result in the Result column so you know
what you actually tested rather than what you assume.

Deploy first — several of these only work over HTTPS.

---

## The four that matter most

| # | Test | Why it is risky | Result |
|---|---|---|---|
| 1 | **Windows PC → Android**, same Wi-Fi | The most common real pairing | |
| 2 | **Windows PC → iPhone**, same Wi-Fi | Safari's WebRTC differs from Chrome's more than any other browser | |
| 3 | **PC on Wi-Fi → phone on mobile data** | Different networks. This is where the relay fallback is actually exercised | |
| 4 | **iPhone → PC**, 200 MB file | iOS Safari holds the whole file in memory. This is where it breaks if it breaks | |

For each: does it pair, does the transfer finish, does the file open correctly
afterwards, and does the panel say `Direct` or `Relayed`?

---

## Known risks by browser

**iOS Safari** is the highest risk, for three separate reasons:

- No File System Access API, so a received file is held entirely in memory
  before you can save it. A large file can crash the tab. Find the size where it
  fails on your own phone and write it down.
- Safari has historically been stricter about how WebRTC data channels are set
  up than Chrome and Firefox.
- Backgrounding the app — a call, a notification, switching apps — can suspend
  the page and kill the transfer mid-file.

**Android Chrome** should behave like desktop Chrome. Watch for the screen
sleeping mid-transfer.

**Firefox** has no File System Access API either, so it shares the memory limit.

---

## Also worth checking

| Test | What you are looking for |
|---|---|
| Scanning the QR from the phone camera app | Opens the site and pairs, rather than doing nothing |
| Typing the code and PIN by hand | The PIN is required — code alone should be refused |
| Folder send, ~20 files | Every file arrives with the right name |
| Text tab | Copy button works on both mobile browsers |
| Locking the phone mid-transfer | Does it survive, or fail cleanly and say so |
| Closing the sender's tab mid-transfer | The receiver is told, rather than hanging forever |
| Wrong PIN entered | Fails clearly instead of transferring corrupted data |
| Two people at once | Both sessions work independently |

---

## Watching it in production

```
https://your-app.onrender.com/api/health
https://your-app.onrender.com/api/metrics
```

`/api/metrics` gives you rooms created, peers joined, relay bytes used, relay
cutoffs, rate-limit hits, and memory. Check it after each test session.

The server also writes one JSON log line per event in production — visible in
Render's **Logs** tab. `relay-limit-hit` and `rate-limited` are the two worth
watching. If `relayBytes` climbs quickly in normal use, most of your traffic is
taking the expensive route and you should look at TURN.

---

## Honest status

Chrome-to-Chrome, direct and relayed, verified byte-for-byte by automated test.

Everything in the table above is **untested on real hardware**. Until you have
worked through it, "Public Beta" is the accurate label — which is exactly what
the audit recommended, and it is right.

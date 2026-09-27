# Updating a live K-Drop

## The short version

```bash
npm run test:all        # or npm test if you have no Chrome set up
npm run release         # the gate
git add .
git commit -m "Forward secrecy, scroll animations, light theme"
git push
```

Render redeploys on push. Two or three minutes.

---

## Bump the cache version — this one is not optional

`public/sw.js` starts with:

```js
const VERSION = 'kdrop-v2';
```

**Increase this every time you change a file the service worker caches**
(`app.js`, `core.js`, the CSS, `index.html`, and the other modules listed in
`SHELL`). The old cache is deleted when the new worker activates.

Skip it and some visitors keep running the previous `app.js` from their cache
while your server serves the new one. That is how you get bug reports nobody
can reproduce.

---

## This release changes the protocol

Relayed transfers now agree a key by ECDH instead of deriving it from the PIN.
A tab still running the old code cannot agree a key with a tab running the new
one.

| Situation | What happens |
|---|---|
| Both devices reload after the deploy | Works normally |
| Both still on the old version | Works normally, on the old scheme |
| One old, one new, **direct** route | Works — the browser handles that encryption |
| One old, one new, **relayed** route | Fails, and says "Both devices need to reload" |

Nobody gets a corrupted file and nobody gets an unencrypted one. The worst case
is a clear message telling them to reload.

Because the service worker is network-first, anyone who reloads gets the new
version immediately. The window is only people who had the page open across the
deploy.

If you have testers, tell them to reload once.

---

## After deploying

1. Open the site and confirm the version in the docs page footer area.
2. Check `/status.html` — everything operational.
3. Send a file between two devices, both reloaded.
4. Check the metrics:

```
https://your-app.onrender.com/api/metrics?token=YOUR_TOKEN
```

`status` should read `healthy`. If `errors` is above zero, look at the Render
logs before doing anything else.

---

## Rolling back

Nothing is stored, so a rollback loses nothing but the newer code.

**Render:** Events tab → find the previous deploy → Rollback.

**Git:**
```bash
git revert HEAD
git push
```

Do not fix forward during an incident. Get back to a build you know works, then
work out what happened.

---

## What changed in this release

- Forward secrecy on the relayed route — ephemeral ECDH per session,
  authenticated by the PIN so the relay cannot substitute keys
- Light theme only; the dark palette was removed
- Scroll animations throughout, none of them pointer-driven, all disabled
  under `prefers-reduced-motion`
- Brand illustrations, drawn rather than photographed, so no third-party image
  host sees your visitors
- Trusted devices, with challenge-response so a familiar name proves nothing

Nineteen test suites cover all of it.

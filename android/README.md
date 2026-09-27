# K-Drop on Android

The plan is a **Trusted Web Activity**: a real Android app, in the Play Store,
that runs the K-Drop web app fullscreen through Chrome's engine. No browser
bar, no "this is just a website" look.

The reason is not laziness. K-Drop's engine is WebRTC, WebCrypto, the File
System Access API and WebSockets — all browser features. Rewriting the pairing,
encryption, resume and relay logic in Kotlin would recreate every bug already
solved here, in a language with no test suite behind it yet.

---

## Read this before starting

**You cannot begin until the web app is live on your own HTTPS domain.** Not
Render's `onrender.com` subdomain — your own. A TWA verifies itself against a
domain you control, and Bubblewrap reads the manifest from a live URL.

**And you should not begin until `TESTING.md` passes on real devices.** Packaging
a transfer app that has never moved a file between a real phone and a real
laptop means shipping unknown bugs to strangers with a Kalman name on them.

Everything below assumes both are done.

---

## What already works, and what the app adds

The web app already handles pairing, transfer, resume, encryption and history.
Wrapping it adds four things that only an installed app can do:

| | |
|---|---|
| **Share sheet** | Gallery → Share → K-Drop. Already built: `share_target` in the manifest, handled in `sw.js`. This is the feature that makes installing worthwhile. |
| **Home screen shortcuts** | Long-press the icon for Send or Receive. Built. |
| **Launcher presence** | An icon, a name, a place in the app list. |
| **Play Store distribution** | Findable, installable, updatable. |

Also built and tested in the web layer, so the TWA inherits them: dark mode
following the system theme (including the Android status and navigation bars,
via the paired `theme-color` meta tags), Android back handling that closes the
scanner, then a dialog, then the chosen role before exiting, an in-app QR
scanner, a screen wake lock held only while a transfer runs, and a completion
notification when the app is in the background.

**Background transfers remain out of scope.** A Trusted Web Activity cannot run
a foreground service, so a transfer stops if the app is closed. The wake lock is
the honest mitigation: it does not make transfers run in the background, it
stops them dying in the foreground. Real background transfer needs a native
Android layer and is worth building only if people ask for it.

---

## Step 1 — Package name, decided once

```
com.kalman.kdrop
```

This is permanent. Once published you cannot change it without shipping a
different app and losing every install. Decide it before you build, not after.

---

## Step 2 — Check the site is ready

Before generating anything, confirm the site can actually be wrapped. Every one
of these is a failure that otherwise surfaces much later as a browser bar
across the top of your app, or a Play rejection.

```bash
npm run android:check https://YOUR-DOMAIN
```

It verifies HTTPS, the manifest and its icons, the share target, the service
worker, asset links, server health, and that Bubblewrap and a JDK are installed.

## Step 3 — Generate the Android project

```bash
npm i -g @bubblewrap/cli
node tools/android-build.js init https://YOUR-DOMAIN
```

That prints the answers to give Bubblewrap's questions and then runs it. Or run
it directly:

```bash
cd android
bubblewrap init --manifest https://YOUR-DOMAIN/manifest.webmanifest
```

It will ask for the package name, app name, colours and icons. `twa-manifest.json`
in this folder has the right answers — copy from it. Bubblewrap overwrites that
file with its own version, which is fine; keep the original as a reference.

Then:

```bash
bubblewrap build
```

You get `app-release-bundle.aab` for the Play Store and an APK for testing.

**Check the target SDK before you submit.** Google Play requires new submissions
to target Android 16 (API 36) from 31 August 2026. Open
`android/app/build.gradle` and confirm:

```gradle
compileSdkVersion 36
targetSdkVersion 36
```

Raise them if Bubblewrap generated something lower.

---

## Step 3 — Link the app to the domain

Without this, your app opens with a browser address bar across the top and
looks unfinished.

Bubblewrap prints a SHA-256 fingerprint when it creates your signing key. But
**the one that matters is Google's**, because Play re-signs your app: Play
Console → Setup → App signing → *SHA-256 certificate fingerprint*.

Set it on your server:

```
ANDROID_SHA256_FINGERPRINT=AB:CD:EF:...
ANDROID_PACKAGE=com.kalman.kdrop
```

The server generates `/.well-known/assetlinks.json` from those. Until they are
set it returns a 404 saying so — deliberately, because serving a file with a
placeholder fingerprint fails verification silently and is miserable to debug.

Verify:

```bash
npm run android:verify https://YOUR-DOMAIN
```

That checks the relation, namespace, package name and fingerprint format —
a malformed fingerprint fails silently and is otherwise painful to diagnose.

Both fingerprints can be listed, comma-separated, so local test builds work too.

---

## Step 4 — Test the share sheet

This is the part most likely to disappoint, so test it first:

1. Install the APK on a real phone.
2. Open the gallery, pick a few photos, tap **Share**.
3. K-Drop should appear in the list.
4. Choose it. The app opens with those files queued.
5. Pair a laptop. The files send.

If K-Drop is missing from the share list, the manifest was not fetched from
your live domain during `bubblewrap init`.

---

## Step 5 — Play Console

**Account.** An Organization account needs a D-U-N-S number and company
verification documents — not possible until Kalman Consultancy Services is
incorporated. A Personal account works now and costs $25 once, but requires a
**closed test with at least 12 testers opted in continuously for 14 days**
before you can apply for production access.

Choose deliberately. Publishing under a personal account and moving it to the
company later is possible but awkward.

**Data Safety form.** This must match what the server actually does, and Google
does check. K-Drop's honest answers:

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Yes — IP address, for security and abuse prevention |
| Files? | Not collected. Direct transfers never reach the server. Relayed transfers pass through encrypted and are never stored. |
| Is data encrypted in transit? | Yes |
| Can users request deletion? | No account exists, so there is nothing to delete |

Do **not** tick "no data collected". Any service on the internet receives an IP
address, and the privacy page in this project says so plainly. Contradicting
your own published policy is the fastest way to a rejection.

**Reviewer instructions.** K-Drop has no login, which confuses reviewers. Give
them this:

```
K-Drop needs two devices — no account is required.

1. Install K-Drop and open it.
2. On a computer, open https://YOUR-DOMAIN in any browser.
3. The app shows a 6-character code and a 4-character PIN.
4. Enter both on the computer, or scan the QR code with the app.
5. The two devices appear in each other's device list.
6. Choose any file and send it. Accept on the other device.
7. The file arrives and is checked for integrity.

If you have only one device, open a second browser window on the same
computer — both windows can pair with each other.
```

**Also required:** privacy policy URL (`/docs.html#privacy`), category
(Productivity), content rating questionnaire, target audience, and an accurate
"contains no ads" declaration.

---

## Step 6 — Store assets

Screenshots should show the actual product, not marketing panels. Take them on
a real device:

- The pairing screen with a code and QR
- Two devices connected
- A transfer in progress with the speed showing
- A completed transfer
- The security page

All of this is generated for you:

```bash
npm run store:assets
```

It pairs two browsers, runs a real transfer, and captures eight screenshots from
the running app — so the listing shows the product rather than a mockup. The
512×512 store icon and the 1024×500 feature graphic are in `store/` alongside
them.

The full listing copy, Data Safety answers and reviewer instructions are in
[`store/LISTING.md`](../store/LISTING.md).

---

## What this does not solve

**Background transfers.** Close the app mid-transfer and it stops. Fixing that
properly needs a foreground service with a persistent notification, which a TWA
cannot do — it would mean a native Android layer. Worth building only if people
actually ask for it.

**iOS.** Apple does not support Trusted Web Activities. iPhone users add K-Drop
to their home screen from Safari, which works and installs nothing. An App Store
version would be a separate project.

---

## Honest ordering

1. Deploy to your own domain with HTTPS
2. Work through `TESTING.md` on real devices
3. Fix whatever that finds
4. Then, and only then, `bubblewrap init`

Steps 1–3 are the whole job. Step 4 takes an afternoon.

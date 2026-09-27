# Play Store listing

Everything to paste into Play Console. Written to describe what K-Drop actually
does — Google compares the listing, the Data Safety form and the privacy policy
against each other, and against the app.

---

## Identity

| Field | Value |
|---|---|
| App name | `K-Drop` |
| Package name | `com.kalman.kdrop` |
| Category | Productivity |
| Contains ads | No |
| In-app purchases | No |
| Content rating | Complete the questionnaire; expect Everyone |
| Target audience | 13+ |
| Developer | Kalman |

**The package name is permanent.** Publishing under it and changing later means
shipping a different app and losing every install.

---

## Short description

*80 characters maximum.*

```
Send files between your devices. No account, no upload, nothing stored.
```

## Full description

*4000 characters maximum. This is under 1500, deliberately.*

```
K-Drop moves files straight from one device to another.

Open K-Drop on both devices, match a short code, and send. Photos, videos,
documents, folders — they travel directly between the two devices whenever the
network allows it, so nothing is uploaded to a server and nothing is left
behind afterwards.

WHAT IT DOES

• Send files between a phone, tablet, laptop or desktop, in any combination
• Pair by scanning a QR code or typing a six-character code and a PIN
• Send several files, or a whole folder, in one go
• Share straight from your gallery using the Android share sheet
• Send text — a link, an address, a Wi-Fi password — without retyping it
• Resume automatically if the connection drops mid-transfer
• Every file is checked on arrival, so a corrupted transfer is reported
  rather than quietly saved

NO ACCOUNT, NO ADS, NO PAID TIER

There is nothing to sign up for and nothing to buy. K-Drop does not show
advertising and does not have a paid version.

PRIVACY

On the direct route your file never reaches our server at all — it goes
browser to browser. When a network blocks that route, the file is encrypted on
your own device before passing through our relay, using a key derived from the
PIN, which we never receive. Either way, your files are never written to our
disks.

We do receive your IP address, because every internet connection involves one,
and we use it to stop the service being flooded. We say so plainly in our
privacy policy rather than claiming to collect nothing.

SPEED DEPENDS ON THE PATH

Two devices on the same Wi-Fi transfer quickly. Devices on different networks
are slower, and K-Drop tells you which route it is using and why.

WHAT IT IS NOT

K-Drop is not cloud storage. Both devices need to be open for a transfer to
run — there is no mailbox holding your file for later. That is the design, not
a missing feature.

Built by Kalman.
```

---

## Reviewer instructions

K-Drop has no login, which reviewers often read as a broken app. Paste this
into **App access → All functionality is available without special access**, or
into the instructions field:

```
K-Drop needs two devices. No account or login is required.

1. Install K-Drop and open it.
2. On a computer, open https://YOUR-DOMAIN in any browser.
3. The app shows a 6-character code and a 4-character PIN.
4. On the computer, enter the code followed by the PIN, or scan the QR code
   shown in the app.
5. The two devices now appear in each other's device list.
6. In the app, tap "Send files", choose any file, and send it.
7. Accept the transfer on the computer. The file arrives and is verified.

If only one device is available: open https://YOUR-DOMAIN in two separate
browser windows on the same computer. They can pair with each other and a
transfer between them demonstrates the full flow.
```

---

## Data Safety form

These answers must match `/privacy.html`. `npm test` checks that they do, and fails if the policy and the code drift apart.

| Question | Answer | Why |
|---|---|---|
| Does your app collect or share user data? | **Yes** | An IP address reaches the server on every connection |
| Data type | **App activity → other**, and **Device or other IDs → IP address** | Used for rate limiting |
| Is it shared with third parties? | **No** | |
| Is collection required? | **Required** — it cannot be switched off | Serving a request needs an address |
| Purpose | **Fraud prevention, security, and compliance** | Abuse limits only |
| Is data encrypted in transit? | **Yes** | TLS, plus DTLS or AES-256-GCM on the transfer itself |
| Can users request deletion? | **No** | No account exists; session data expires within an hour |
| Files, photos, videos | **Not collected** | Direct transfers never reach the server. Relayed ones pass through encrypted and are never written to disk. |

**Do not select "No data collected".** It is false for any internet service,
it contradicts your own privacy policy, and it is a common rejection.

Related pages Play may ask for:

| Page | URL |
|---|---|
| Data retention | `https://YOUR-DOMAIN/data-retention.html` |
| Acceptable use | `https://YOUR-DOMAIN/acceptable-use.html` |
| Security | `https://YOUR-DOMAIN/security.html` |

---

## Assets

Generated into `store/` by `node tools/store-assets.js`:

| File | Use |
|---|---|
| `play-icon-512.png` | Store icon. 512×512, no alpha, no rounded corners — Play adds those. |
| `feature-graphic.png` | Feature graphic, 1024×500 |
| `screenshots/01-home.png` | First screen |
| `screenshots/02-pairing.png` | The code and QR |
| `screenshots/03-connected.png` | Two devices linked |
| `screenshots/04-transferring.png` | A real transfer with live speed |
| `screenshots/05-complete.png` | Completed, with history |
| `screenshots/06-how-it-works.png` | The explanation |
| `screenshots/07-privacy.png` | Privacy |
| `screenshots/08-dark.png` | Dark mode |

Screenshots are captured from the running app during an actual transfer, not
mocked. Regenerate them after any visual change so the listing stays truthful.

Play needs at least 2 phone screenshots and shows up to 8.

---

## Required URLs

| Field | Value |
|---|---|
| Privacy policy | `https://YOUR-DOMAIN/privacy.html` |
| Terms | `https://YOUR-DOMAIN/terms.html` |
| Support / contact | Add a real address to `public/security.html` first |
| Website | `https://YOUR-DOMAIN` |

---

## Before you submit

- [ ] `node tools/android-build.js check https://YOUR-DOMAIN` passes
- [ ] `targetSdkVersion 36` in `android/app/build.gradle`
- [ ] Asset links verified: `node tools/android-build.js verify https://YOUR-DOMAIN`
- [ ] Share sheet tested on a real phone from the gallery
- [ ] `TESTING.md` completed on real devices
- [ ] A real security contact address in `public/security.html`
- [ ] `android.keystore` is not in the repository — `node tests/scan-secrets.js`
- [ ] Screenshots regenerated after the last visual change

---

## Testing track

A new personal developer account must run a closed test with **at least 12
testers opted in continuously for 14 days** before applying for production
access. Plan for that: it is two weeks of calendar time, not work.

An organisation account avoids it but needs a D-U-N-S number and company
verification documents, which needs Kalman Consultancy Services incorporated
first.

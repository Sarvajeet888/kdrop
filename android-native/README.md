# KDrop Android preview source

Native Kotlin Android 10+ app. This is separate from the older `android/` TWA
configuration, which wraps the website.

Implemented source:

- Same-LAN/hotspot TLS 1.3 sending and receiving using native protocol v1.
- QR camera scanning, pairing QR display and manual code paste.
- System document and destination-folder pickers; no all-files permission.
- Per-file receiver approval and SHA-256 verified resume.
- Foreground data-sync service with stop notification, wake/Wi-Fi locks and
  Android 15 timeout handling. Start transfers while the app is in the foreground.
- Receiver measured throughput and storage-write explanations.
- Completion only after the selected destination is re-read and verified.

## Build

Open this directory in Android Studio with JDK 17 and SDK 35, or use Gradle 8.10.2:

```text
gradle :app:assembleDebug :app:lintDebug
```

Expected debug APK: `app/build/outputs/apk/debug/app-debug.apk`.
There is no Gradle wrapper binary in this source yet; install the specified Gradle
or use the configured GitHub build job. Debug APKs are for testing only.

## Pair

Connect both devices to the same router or hotspot. On the receiver choose a
destination folder, check the displayed IPv4 address, and start receiving.
On the sender scan that QR, choose a file, and send. Approve it on the receiver.
After interruption, retry the same source and pairing code while the receiver
session stays open. Restarting the receiver requires its new pairing code.
Different network interfaces/VPNs can make automatic IP selection wrong; edit the
address to the interface reachable by the other device. Client-isolated Wi-Fi
can prevent local connections; this preview has no automatic relay fallback.

## Current limits

This source has **not been compiled or run on Android in the authoring environment**.
The configured CI job must pass, followed by Android-to-Windows and Android-to-
Android physical-device tests, before calling it usable. No APK is included.

- IPv4 only in the Android UI/protocol adapter; one file/session at a time.
- Sending stages the selected SAF document in app cache to make it seekable for
  verified resume. This requires free space approximately equal to the file size
  and adds preparation time. A later seekable-descriptor path should avoid copies.
- Receiving stages a partial in private app storage, then copies to the selected
  provider and re-verifies it. It can require twice the file's storage capacity.
- Choose a local destination supporting file sync and reread. Some cloud/virtual
  document providers will refuse these operations and the transfer will fail.
- Sender shows phases; receiver shows measured speed. No live throughput claim
  is made on the sender until the protocol adds receiver progress messages.
- Partials persist in app storage until completed or app data is cleared. Storage
  management UI, batching, device discovery and automatic hotspot creation remain.
- A peer that connects but does not send can occupy this single-session listener
  until timeout; pairing capabilities expire when the receiver process stops.
- Android background restrictions still apply. The foreground-service timeout
  handler cancels safely; very long transfers may require resuming a new session.
- QR contains a private capability: do not post screenshots or codes publicly.
- No measured cross-device throughput or 1 GB/s claim is available yet.

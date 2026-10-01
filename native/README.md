# KDrop Native — first local-transfer milestone

This is the **desktop command-line transfer core**. Client source now lives in
`../desktop` (Windows/Tauri) and `../android-native` (Android/Kotlin). These clients
are uncompiled previews, not published installers. They use a separate native
LAN protocol alongside the existing browser app. The browser cannot yet pair
with this native protocol.

## Implemented

- Direct TLS 1.3 over TCP; no cloud server or internet is required after installation.
- Ephemeral receiver certificate pinned through the pairing payload, plus a random
  256-bit capability token. There is no accept-all certificate verifier.
- Receiver creates pairing text and an SVG QR. The QR contains the same private
  capability as the text. Native camera scanning is a later client feature.
- Explicit receiver approval for every file, including retries.
- Bounded 1 MiB chunks, per-chunk SHA-256 and whole-file verification.
- Resume from a receiver partial only when its prefix hash matches the source.
  Changed/corrupt partials restart at zero.
- Stream to a partial on disk, sync and verify, then publish without overwriting
  any existing file. The sender succeeds only after a delivery receipt.
- Receiver throughput and measured storage-write share. No invented Wi-Fi diagnosis.

## Build

Install the stable Rust toolchain with Cargo on the development computer.

```powershell
cd native
cargo test
cargo build --release
```

Windows output: `target\release\kdrop-native.exe`.
Linux output: `target/release/kdrop-native`.
Dependencies are required for the build; transfers themselves work offline.
The `native.yml` workflow builds and tests both Windows and Linux.

## Try two Windows computers on the same Wi-Fi or hotspot

Find the receiving computer's LAN IPv4 address with `ipconfig`.
Use that address instead of `192.168.1.10` below. Allow the application through
Windows Firewall for your private network if Windows prompts.

On the receiver, from `native`:

```powershell
.\target\release\kdrop-native.exe receive .\received 0.0.0.0:45871 192.168.1.10 pairing-1.txt
```

Pass `pairing-1.txt` privately to the sender (or copy its text into a local file).
Do not commit pairing files or publish them. The QR is generated as `pairing-1.svg`.
The sender currently reads text from a file; camera scanning and app deep links
are not implemented in this CLI.

On the sender:

```powershell
.\target\release\kdrop-native.exe send pairing-1.txt "C:\Users\YourName\Downloads\video.mp4"
```

Type `y` at the receiver's prompt. Keep both processes open. If interrupted, run
the sender command again; the receiver checks the partial and resumes it.
If the receiver restarts, generate a new pairing filename/code and use it on the
sender; partials remain available, but old capabilities no longer authenticate.

For a one-computer smoke test, use `127.0.0.1` for both bind and advertised IP.
Loopback throughput is not a claim about Wi-Fi or separate physical devices.

## Protocol

All fields and bytes below travel inside the pinned TLS connection. Control
messages are UTF-8 JSON preceded by a 4-byte big-endian length (maximum 16 KiB).

1. Sender hashes the source and sends `offer` with `token` and
   `file: {name, size, sha256}`. Receiver validates limits and requests approval.
2. Receiver replies `ready` with `offset` and `prefix_sha256` for its partial.
3. Sender replies `start` with that offset, or zero if the prefix does not match.
4. Until the declared file size is reached, each data frame contains a 4-byte
   big-endian length, 32-byte SHA-256, then 1–1,048,576 payload bytes.
5. Receiver syncs, hashes and publishes the complete file, then sends `done` with
   `sha256` and `saved_as`. A refusal is `reject` with a human-readable `reason`.

Pairing: `kdrop://pair/<base64url-without-padding-JSON>` containing version `1`,
advertised socket address, base64url DER certificate, and base64url random token.
Only LAN/loopback/link-local addresses are accepted by this prototype.

## Current limits and next work

- **Build status:** this authoring environment has no Rust toolchain; native tests
  are supplied but have not been executed here. Run CI before distributing binaries.
- Android/Windows client source has been added separately, including Android
  camera scanning and foreground-service handling. Platform compilation and
  physical-device verification are still pending. Discovery, automatic hotspot
  setup and native-to-browser bridging are not implemented.
- One file/connection and one receiver connection at a time. A stalled client
  can occupy the receiver until timeout; do not expose this prototype publicly.
- Receiver approval input itself has no timeout. Network reads time out after
  five minutes and writes after thirty seconds.
- Source prehash and final full verification add I/O; this prioritizes correctness.
  Very large files may exceed the prototype's fixed timeouts during hashing.
- Partial files remain under `.kdrop-partials` in the selected directory. Delete
  them manually when you no longer want resumable copies. No disk-quota reservation
  or automatic cleanup is implemented yet. Use a private, trusted destination folder.
- Final publication requires a filesystem supporting hard links (e.g. NTFS,
  ext4). FAT/exFAT destinations are not supported by this first version.
- Progress means bytes written through the OS; only completion includes `sync_all`
  and whole-file verification. Sender progress UI is a later client feature.
- A lost final receipt can result in a duplicate on retry; exactly-once delivery
  and persistent completion records are future protocol work.
- The receiver identity changes per launch. Pair only through a trusted channel;
  this is not a persistent verified-device identity system yet.
- The synchronous engine is a correctness baseline, not the final optimized
  pipeline. No 1 GB/s benchmark has been achieved or claimed.

Next: pass native and app build jobs and physical-device interoperability tests.
Profile the baseline before adding read-ahead or parallel encryption/hash workers.

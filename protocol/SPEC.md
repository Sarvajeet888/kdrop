# K-Drop Transfer Protocol — KDTP/1

A specification of how two K-Drop clients find each other and move a file.

This exists so the protocol can be understood, reimplemented, or argued with
without reading the application. Everything here is what the current
implementation does; where the implementation and this document disagree, the
implementation is the bug — or this document is out of date, and that is also a
bug.

**Version:** KDTP/1 · **Status:** stable in K-Drop 1.0.0

---

## 1. Shape

Three parties. Two clients, one server. The server introduces the clients and
then, in the normal case, stops being involved.

```
   Client A                    Server                    Client B
      │                          │                          │
      │───── create ────────────►│                          │
      │◄──── room ───────────────│                          │
      │                          │◄──────── join ───────────│
      │◄──── peer-joined ────────│───────── joined ────────►│
      │                          │                          │
      │◄════ signal (offer/answer/candidates, relayed) ═════►│
      │                          │                          │
      │◄─────────── direct data channel ────────────────────►│
      │                          │                          │
      │            (server no longer in the path)            │
```

When a direct channel cannot be established, the server carries the bytes
instead — encrypted by the clients, with a key the server never receives.

### Design constraints

1. **The server must never be able to read a file.** This shapes everything:
   the key comes from a secret the server does not see, and the direct path is
   preferred so the question usually does not arise.
2. **No accounts, no persistence.** A session is memory on the server and
   disappears when the last participant leaves.
3. **The receiver is the authority on what it has.** Bytes can be lost after a
   sender releases them, so resume asks the receiver rather than assuming.
4. **Fail loudly.** A silent no-op is worse than an error. A transfer that did
   not arrive must never report success.

---

## 2. Identity and pairing

There is no identity. A client is whoever holds the session code, for as long
as the session lasts.

### Session code

Six characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` — 31 symbols, with
`0`, `1`, `O`, `I` and `L` removed because codes are read aloud and off screens.

Space: 31⁶ ≈ 8.9 × 10⁸. Guessing is impractical, and repeated failures from one
source earn a temporary block regardless.

Generated with a cryptographic random source. Never logged.

### PIN

Four characters from the same alphabet, generated **on the client**.

The PIN is never transmitted to the server. It reaches the other device by one
of two routes:

- inside the fragment of the pairing link (`https://host/#CODEPIN`) — browsers
  do not send fragments to servers
- typed by a person

Pairing without a PIN is refused, in the interface and again in the transport.
Joining with only the code would work, and would silently drop end-to-end
encryption the moment a network forced the relayed route. A quiet downgrade is
worse than a refusal.

### Device fingerprint

Both sides compute a code from the two public keys, sorted so the result does
not depend on who spoke first:

```
fp = SHA-256(sort(pub_a, pub_b) concatenated)
     first 12 bytes mapped onto the pairing alphabet, grouped 4-4-4
```

Displayed on both devices for a person to compare. A substituted key produces a
different code on each side. This is the only check in the protocol performed
by a human, and it is advisory — a client MUST NOT refuse a transfer because it
was not confirmed.

### Key derivation

The PIN produces an **authentication** secret, not the key that encrypts files.

```
auth = PBKDF2-SHA256(
         password   = code + ":" + PIN,
         salt       = "k-drop.auth.v1",
         iterations = 150000,
         length     = 256 bits
       )
```

The file key is agreed per session by ECDH on P-256:

```
each side:  (priv, pub) = ECDH-P256 keypair, ephemeral
sends:      pub, HMAC-SHA256(auth, pub)
verifies:   the peer's HMAC before accepting their pub
shared    = ECDH(priv, peer_pub)
key       = HKDF-SHA256(shared, salt = "k-drop.session.v1",
                        info = "file-transfer", length = 256 bits)
```

Used with AES-256-GCM. Private halves never leave the device and are discarded
when the page closes, so a recorded session cannot be decrypted later even by
someone who learns the code and PIN.

The HMAC step is not optional. The server relays the public keys, so without it
a malicious relay could substitute its own and read everything. A public key
whose HMAC does not verify MUST be refused, not merely reported.

---

## 3. Signalling

JSON over a WebSocket at `/ws`. Text frames are control, binary frames are
relayed file data.

### Client to server

| Message | Meaning | Reply |
|---|---|---|
| `{t:"create", name}` | Start a session | `{t:"room", code, id, host}` |
| `{t:"join", code, name}` | Join one | `{t:"joined", code, id, peers[]}` |
| `{t:"signal", to, data}` | Forward to a peer | delivered as `{t:"signal", from, data}` |
| `{t:"ctl", to, data}` | Forward a control message | delivered as `{t:"ctl", from, data}` |
| `{t:"relay-open", to}` | Route my binary frames to this peer | `{t:"relay-ready", to}` |
| `{t:"relay-close"}` | Stop relaying | — |
| `{t:"rename", name}` | Change display name | peers get `{t:"peer-renamed"}` |
| `{t:"outcome", r}` | Increment one counter | — |
| `{t:"leave"}` | Leave the session | peers get `{t:"peer-left"}` |
| `{t:"ping", ts}` | Liveness | `{t:"pong", ts}` |

`outcome` accepts exactly one of `ok`, `failed`, `direct`, `relayed`,
`resumed`. It carries nothing else — no identifier, no size, no session
reference. Anything richer would make it a record of a person rather than a
gauge on the service.

### Server to client

`hello`, `room`, `joined`, `peer-joined`, `peer-left`, `peer-renamed`,
`signal`, `ctl`, `relay-ready`, `relay-limit`, `expired`, `error`.

`error` carries a `reason`: `no-room`, `full`, `rate-limited`, `too-many`,
`blocked`.

### Server obligations

- Forward `signal` and `ctl` payloads unread and unmodified.
- Never write a session code, a PIN, or a filename to a log.
- Never retain relayed bytes.
- Reject a control frame over 64 KB before parsing it.
- Accept only objects with a string `t`.

---

## 4. Transport selection

```
        try direct
            │
     ┌──────┴──────┐
   opens        9s pass,
     │          or fails
     ▼             │
  DIRECT           ▼
  DTLS          RELAYED
  applied       AES-256-GCM
  by the        applied by
  browser       the client
```

A client MUST attempt a direct connection first, and MUST fall back rather than
fail. It MUST tell the person which route is in use — the two have materially
different speed and privacy properties, and hiding the difference would make
the privacy claim misleading.

A client MUST NOT send on the relayed route without a key. If one is missing,
it raises an error rather than sending plaintext.

### Framing

| | Direct | Relayed |
|---|---|---|
| Frame size | 64 KB | 256 KB |
| Encryption | DTLS, by the browser | AES-256-GCM, by the client |
| Buffer ceiling | 4 MB | 16 MB |

64 KB rather than the 256 KB that `sctp.maxMessageSize` advertises: frames that
large tear the channel down partway through a large transfer. 4 MB rather than
higher: a data channel whose buffer reaches 16 MB is closed by the browser.

Relayed frames are `[12-byte IV][ciphertext + GCM tag]`, a fresh IV per frame.

---

## 5. Transfer

Peer to peer, over whichever route is active. JSON for control, binary for
content.

```
   Sender                                   Receiver
     │                                         │
     │──── batch (manifest, total) ───────────►│
     │                                         │  a person decides
     │◄─── batch-ok  |  batch-no ──────────────│
     │                                         │
     │──── fstart (fid, name, size, type) ────►│
     │──── binary ────────────────────────────►│
     │──── binary ────────────────────────────►│
     │──── fend (fid, crc) ───────────────────►│  verify
     │                                         │
     │──── bdone (bid) ───────────────────────►│
```

| Message | Meaning |
|---|---|
| `{t:"batch", bid, files[], total}` | Ask permission. `files[]` has `fid`, `name`, `size`, `type`. |
| `{t:"batch-ok"｜"batch-no", bid}` | The receiver's answer |
| `{t:"fstart", fid, name, size, type}` | Next file begins |
| `{t:"fend", fid, crc}` | File complete; CRC-32, lowercase hex |
| `{t:"bdone", bid}` | Batch complete |
| `{t:"cancel", bid}` | Sender aborted |
| `{t:"note", text}` | Text transfer, no file involved |
| `{t:"resume-ask", bid, fid}` | Sender asks how much of a file arrived |
| `{t:"resume-at", bid, fid, got}` | Receiver's answer, in bytes |
| `{t:"fresume", fid, from}` | Sending continues from an agreed offset |

Nothing moves until `batch-ok`. An implementation MUST NOT begin sending
content on the strength of `batch` alone.

### Ordering

Binary frames and control messages share one ordered channel, and the receiver
MUST process them in arrival order. `crypto.subtle.decrypt` does not settle in
call order, so a naive implementation decrypting concurrently will deliver a
file that is complete and scrambled. A single promise chain per link is the
minimum correct approach.

### Integrity

CRC-32 over each file, computed independently by both sides and compared at
`fend`. A mismatch MUST be reported, never silently saved.

CRC-32 detects accidental corruption. It is not a signature and does not
protect against a peer that deliberately sends wrong bytes — but that peer was
invited into the session, so the threat model does not include them.

### Filenames

A filename is remote input. Before a receiver writes it or displays it, it MUST
strip path separators, control characters and Unicode direction overrides.

The last of those is the one worth stating: `invoice\u202Egnp.exe` is displayed
by most systems as `invoiceexe.png`. A receiver that renders the name as sent
is showing its user a lie.

---

## 6. Resume

```
   connection lost
         │
         ▼
   reconnect, rejoin the same session
         │
         ▼
   sender ── resume-ask (fid) ──► receiver
   sender ◄─ resume-at (got)  ──  receiver
         │
         ▼
   sender ── fresume (from) ───► receiver
         │
         ▼
   continue from `got`
```

**The receiver is the authority.** The sender's idea of how much it sent is an
upper bound; bytes can be lost after release. Resuming from the sender's count
would silently omit whatever was in flight.

If `fresume.from` does not equal what the receiver holds, the receiver MUST
restart that file rather than append. Appending at a disagreed offset produces
a file that is the right length and wrong.

`resume-ask` MUST be retried — a link that has just come back can drop the
first message — and MUST be sent over every live link, since a reconnect may
briefly leave more than one.

Only one resume attempt may run at a time. Two interleave their chunks.

The sender rebuilds its checksum by re-reading the already-sent portion from
local disk, which is far cheaper than re-sending it.

---

## 7. Abuse handling

| Limit | Default | Scope |
|---|---|---|
| Sockets | 16 | per address |
| Sessions | 30/hour | per address |
| Sessions | 5000 | server-wide |
| Relayed bytes | 2 GB | per session |
| Control messages | 200 / 10s | per socket |
| Failed joins | 20/hour | per address |
| Session lifetime | 30 min idle | per session |
| Connection lifetime | 6 hours | per socket |

Exceeding the message or failed-join limits earns a temporary block, 15 minutes
by default. Blocks are on an address, not a person, because there are no people
to identify.

The client address is taken `TRUST_PROXY_HOPS` entries from the **right** of
`x-forwarded-for`. Proxies append; anything at the left came from the client and
can be forged.

---

## 8. What this protocol does not do

Stated so an implementer is not surprised.

- **No store and forward.** Both parties are present or nothing happens.
- **No identity or trust between sessions.** Every pairing starts fresh.
- **No protection against a peer you invited.** Forward secrecy covers a
  recording of the wire; it does not cover the device you deliberately sent
  the file to.
- **No protection from your peer.** They see everything you send them. That is
  the feature.
- **No group transfers.** The relay assumes two parties.
- **No compression.** Most large files are already compressed.

---

## 9. Reimplementing this

A client must:

1. Speak the signalling messages in §3.
2. Attempt direct first, fall back after 9 seconds (§4).
3. Derive the key exactly as in §2 — the constants are load-bearing.
4. Ask permission before sending (§5).
5. Verify CRC-32 and report a mismatch (§5).
6. Sanitise filenames before writing or displaying (§5).
7. Preserve message ordering (§5).
8. Never send on the relayed route without a key (§4).

Items 5 through 8 are the ones a first implementation tends to skip, and each
produces a failure that looks like something else: a corrupted file, a spoofed
name, a scrambled transfer, or a privacy claim that is no longer true.

## Delivery-confirmation extension (September 2026)

Updated senders advertise `receipts: 1` on `batch` and require the same field
on `batch-ok`. If absent, cancel and ask both devices to reload; never imply
that an old client has confirmed delivery.

- `file-progress`: `{t, bid, fid, got}`. Cumulative receiver-processed offset.
  Sent every 100 ms while receiving and every 1 MiB on a direct route.
  Sender keeps at most approximately 8 MiB ahead of that offset; the transport
  queue is separately bounded by the existing 4 MB high-water mark.
- `file-ack`: `{t, bid, fid, ok: true}`. Sent only after byte count and CRC match
  and the disk writer closes successfully, or a memory Blob is constructed.
- `batch-ack`: `{t, bid, ok: true}`. Sent after `bdone` only if every file passed.
  Sender success requires this receipt, not merely queued outgoing bytes.
- `transfer-error`: `{t, bid, reason}`. Failure to write or verify on the receiver
  terminates the sending transfer with a visible error.

Confirmation/receiver-progress waits time out after 30 seconds without the
required response. A file received into memory still needs the user's Save
click to persist to their downloads folder. An acknowledgement of that Blob
is not a claim that the user saved it.

Disk chunks are accumulated into 1 MiB writes. The single inbound queue awaits
decryption AND disk delivery before processing `fend`/`bdone`. Close errors
are failures. `resume-at` can include `complete: true` when the requested file
has already passed verification, allowing recovery from a lost file receipt.
A resumed sending attempt invalidates the previous attempt before sending.

Direct frames use up to 64 KB, respecting a smaller SCTP maxMessageSize.
They no longer shrink merely because the send buffer is occupied: event-based
backpressure bounds the queue. The next 4 MiB source slice is prefetched.

After fallback, a late direct channel is closed rather than switching an
active byte stream between two differently ordered transports. Reconnect to
attempt a new direct route. Relay routing is reasserted for the active sending
peer, and received binary data is handled by the active receiver's link.

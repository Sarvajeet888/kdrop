/**
 * K-Drop core — signalling, peer links, transfer engine.
 * A free file transfer tool by Kalman.
 *
 * Two devices in a room try a direct browser-to-browser connection first.
 * If the network refuses that, they fall back to a server relay and encrypt
 * every byte with a key the server never sees.
 */

import { safeFilename } from './filename.js';
/* ============================================================ small utils */

export const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
};

export const fmtRate = (bps) => (bps > 0 ? `${fmtBytes(bps)}/s` : '—');

export const fmtEta = (s) => {
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${Math.ceil(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** CRC-32 — cheap end-to-end check that the file arrived byte-identical. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export class Crc32 {
  constructor() { this.c = 0xffffffff; }
  update(bytes) {
    let c = this.c;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    this.c = c >>> 0;
    return this;
  }
  get value() { return ((this.c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'); }
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  let os = 'Device';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Linux/.test(ua)) os = 'Linux';
  let br = '';
  if (/Edg\//.test(ua)) br = 'Edge';
  else if (/OPR\//.test(ua)) br = 'Opera';
  else if (/Chrome\//.test(ua)) br = 'Chrome';
  else if (/Firefox\//.test(ua)) br = 'Firefox';
  else if (/Safari\//.test(ua)) br = 'Safari';
  return br ? `${os} · ${br}` : os;
}

/* =========================================================== E2E crypto */

const te = new TextEncoder();

/**
 * Derives an AES-GCM key from the room code plus the pairing PIN.
 * The PIN travels in the QR link fragment or is typed by hand — it is never
 * sent to the server, so the relay cannot read what it carries.
 */
/* ============================================ ephemeral key agreement ==== */

/**
 * Forward secrecy for the relayed route.
 *
 * The PIN-derived key alone has a weakness worth fixing: it is the same key
 * every time for a given code and PIN. Someone who recorded a relayed session
 * and later learned both could decrypt what they captured.
 *
 * So the PIN key is no longer used to encrypt files. Instead each device
 * generates a throwaway ECDH keypair, the two agree a session key from them,
 * and the private halves are discarded when the tab closes. A recording of
 * today's session cannot be decrypted tomorrow by anyone, including someone
 * who learns the code and PIN.
 *
 * The PIN still does essential work: it AUTHENTICATES the exchange. Our own
 * server relays the public keys, so without that step a malicious relay could
 * substitute its own keys and sit in the middle. Each public key is sent with
 * an HMAC under the PIN-derived key, and a key that does not verify is
 * refused outright.
 */

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

export async function makeEphemeralKeys() {
  if (!(window.crypto && crypto.subtle)) return null;
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { pair, publicRaw: new Uint8Array(raw) };
}

/** Prove a public key came from someone who knows the PIN. */
export async function tagPublicKey(authKey, publicRaw) {
  const key = await crypto.subtle.importKey(
    'raw', await crypto.subtle.exportKey('raw', authKey).catch(() => authKey),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, publicRaw));
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Turn our private half and their public half into the key that actually
 * encrypts files. Refuses if their key is not authenticated by the PIN.
 */
export async function agreeSessionKey(mine, theirRaw, theirTag, authRaw) {
  if (!mine || !theirRaw || !authRaw) return null;

  const expect = await hmacRaw(authRaw, theirRaw);
  if (!sameBytes(expect, theirTag)) {
    throw new Error('peer key failed authentication — refusing to agree a key');
  }

  const theirKey = await crypto.subtle.importKey('raw', theirRaw, ECDH, false, []);
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirKey }, mine.pair.privateKey, 256
  );

  // Run the raw shared secret through HKDF rather than using it directly; the
  // output of ECDH is not uniformly distributed and is not a key.
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('k-drop.session.v1'), info: te.encode('file-transfer') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * A short code both devices can display and a person can compare.
 *
 * Everything else in the pairing is checked by software. This is the one check
 * a human performs, and it exists because software cannot rule out every way a
 * key exchange might be interfered with — but a person reading four characters
 * off two screens can.
 *
 * Derived from both public keys, sorted so each side computes the same value
 * regardless of who spoke first. If anything substituted a key in the middle,
 * the two devices produce different codes and the mismatch is visible.
 *
 * Uses the same alphabet as the pairing code: no 0/O/1/I/L, because these are
 * read aloud across a room.
 */
const FP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export async function deviceFingerprint(mineRaw, theirRaw) {
  if (!mineRaw || !theirRaw || !(window.crypto && crypto.subtle)) return null;

  // Sort so both ends hash the same input. Without this the two devices would
  // compute different codes from identical material and every session would
  // look like an attack.
  const [a, b] = [mineRaw, theirRaw].sort((x, y) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] !== y[i]) return x[i] - y[i];
    }
    return x.length - y.length;
  });

  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));

  // 12 characters from a 31-symbol alphabet is about 59 bits — far beyond
  // what anyone could brute-force into matching while a session is open.
  let out = '';
  for (let i = 0; i < 12; i++) out += FP_ALPHABET[digest[i] % FP_ALPHABET.length];
  return `${out.slice(0, 4)} ${out.slice(4, 8)} ${out.slice(8, 12)}`;
}

export async function hmacRaw(secretRaw, message) {
  const key = await crypto.subtle.importKey(
    'raw', secretRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
}

/**
 * Raw bytes derived from the code and PIN, used only to authenticate the key
 * exchange above. Never used to encrypt a file.
 */
export async function deriveAuthSecret(code, pin) {
  if (!pin || !(window.crypto && crypto.subtle)) return null;
  const base = await crypto.subtle.importKey('raw', te.encode(`${code}:${pin}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: te.encode('k-drop.auth.v1'), iterations: 150_000, hash: 'SHA-256' },
    base, 256
  );
  return new Uint8Array(bits);
}

export async function deriveKey(code, pin) {
  if (!pin) return null;

  // crypto.subtle only exists in a secure context. Over plain http — which is
  // what testing on a local network address gives you — it is undefined, and
  // reaching into it throws before the page has finished starting. Degrade to
  // no key instead: direct transfers still work and are still encrypted by the
  // browser, and the relay path refuses to run without a key rather than
  // quietly sending plaintext.
  if (!(window.crypto && crypto.subtle)) return null;

  const base = await crypto.subtle.importKey('raw', te.encode(`${code}:${pin}`), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: te.encode('k-drop.kalman.v1'), iterations: 150_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function seal(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), 12);
  return out.buffer;
}

async function open(key, buf) {
  const b = new Uint8Array(buf);
  const iv = b.subarray(0, 12);
  const ct = b.subarray(12);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
}

/* ============================================================== signalling */

export class Signal extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.id = null;
    this.code = null;
    this.retry = 0;
    this.closedByUs = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.retry = 0;
      this.emit('open');
    };

    this.ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return this.emit('binary', ev.data);
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello') this.id = m.id;
      if (m.t === 'room' || m.t === 'joined') this.code = m.code;
      this.emit(m.t, m);
      this.emit('*', m);
    };

    this.ws.onclose = () => {
      this.emit('close');
      if (this.closedByUs) return;
      // Reconnect with a widening gap so a flaky Wi-Fi drop heals itself.
      const wait = Math.min(1000 * 2 ** this.retry++, 15_000);
      setTimeout(() => this.connect(), wait);
    };

    this.ws.onerror = () => this.emit('error');
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); return this; }

  get ready() { return this.ws && this.ws.readyState === WebSocket.OPEN; }
  // These return false when the socket is not open. Callers must check —
  // a silent no-op here means a transfer "completes" without arriving.
  send(obj) {
    if (!this.ready) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  sendBinary(buf) {
    if (!this.ready) return false;
    this.ws.send(buf);
    return true;
  }
  get bufferedAmount() { return this.ws ? this.ws.bufferedAmount : 0; }
}

/* ================================================================== link */

/**
 * Frame sizes and flow control.
 *
 * 16 KB was the old universally-safe data-channel frame, and small frames are
 * what made transfers slow: a gigabyte at 16 KB is ~65,000 sends, each one an
 * await and an event-loop turn. At 64 KB it is ~16,000.
 *
 * 64 KB rather than the 256 KB that sctp.maxMessageSize advertises: frames
 * that large tear the channel down partway through a large transfer.
 *
 * The buffer ceiling stays at 4 MB because Chrome closes a data channel whose
 * send buffer reaches 16 MB.
 */
const DC_CHUNK = 64 * 1024;
const DC_CHUNK_SAFE = 16 * 1024;
const WS_CHUNK = 256 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;

/**
 * A Link is one connection to one other device. It hides whether the bytes
 * are travelling directly or through the relay — everything above this line
 * just calls send() and listens.
 */
export class Link extends EventTarget {
  constructor(signal, peerId, opts = {}) {
    super();
    this.signal = signal;
    this.peerId = peerId;
    this.polite = opts.polite ?? false;
    this.iceServers = opts.iceServers || [];
    this.key = null;                    // set only by the ephemeral exchange
    // A getter, not a snapshot. The secret is derived asynchronously after
    // joining, and a peer can connect before that finishes — a link created
    // in that window would hold null forever and never agree a key.
    this._authSecret = opts.authSecret || null;
    this.getAuthSecret = opts.getAuthSecret || (() => this._authSecret);
    this.ephemeral = null;
    this.keyReady = null;               // resolves once a session key exists

    this.mode = 'connecting';     // connecting | direct | relayed | down
    this.pc = null;
    this.dc = null;
    this.making = false;
    this.ignoring = false;
    this.fellBack = false;
    this.rtt = null;
  }

  emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
  on(t, fn) { this.addEventListener(t, (e) => fn(e.detail)); return this; }

  /* --------------------------------------------------- key agreement */

  /**
   * Offer our throwaway public key, tagged so the other side can tell it came
   * from someone holding the PIN. Runs on every link, because a link can be
   * direct now and relayed after a reconnect.
   */
  async startKeyExchange() {
    const auth = this.getAuthSecret();
    if (!auth || this.ephemeral || this.kxStarting) return;

    // Guard against a second call while the first is still generating keys;
    // two keypairs would leave the tag we already sent describing the wrong one.
    this.kxStarting = true;
    try {
      this.ephemeral = await makeEphemeralKeys();
      if (!this.ephemeral) return;
      const tag = await hmacRaw(auth, this.ephemeral.publicRaw);
      this.send({
        t: 'kx',
        pub: [...this.ephemeral.publicRaw],
        tag: [...tag],
      });
    } catch (e) {
      console.warn('key exchange', e);
    } finally {
      this.kxStarting = false;
      this.flushPendingKx();
    }
  }

  async onKeyExchange(m) {
    const auth = this.getAuthSecret();
    if (!auth) {
      // Our own secret is not ready yet. Remember the offer and handle it once
      // it is, rather than failing a perfectly good connection.
      this.pendingKx = m;
      return;
    }
    try {
      if (!this.ephemeral) {
        if (this.kxStarting) { this.pendingKx = m; return; }
        this.kxStarting = true;
        this.ephemeral = await makeEphemeralKeys();
        this.kxStarting = false;
      }
      const theirRaw = new Uint8Array(m.pub || []);
      const theirTag = new Uint8Array(m.tag || []);

      this.key = await agreeSessionKey(this.ephemeral, theirRaw, theirTag, auth);

      // A code a person can compare across the two screens.
      this.fingerprint = await deviceFingerprint(this.ephemeral.publicRaw, theirRaw);
      this.emit('secure', Boolean(this.key));
      this.emit('fingerprint', this.fingerprint);

      // Answer, so whichever side spoke first the other still gets our key.
      if (!this.kxAnswered) {
        this.kxAnswered = true;
        const tag = await hmacRaw(auth, this.ephemeral.publicRaw);
        this.send({ t: 'kx', pub: [...this.ephemeral.publicRaw], tag: [...tag] });
      }
    } catch (e) {
      // An unauthenticated key is a substitution attempt or a wrong PIN.
      // Either way the relay stays unusable, which is the safe outcome.
      this.key = null;
      this.kxStarting = false;
      this.emit('note', 'the other device could not prove it knows the PIN');
      console.warn('key exchange rejected', e.message);
    }
  }

  /** Called once our own secret exists, for an offer that arrived too early. */
  flushPendingKx() {
    const m = this.pendingKx;
    if (!m || !this.getAuthSecret()) return;
    this.pendingKx = null;
    this.onKeyExchange(m);
  }

  /* ---------------------------------------------------------- lifecycle */

  async start(initiator) {
    // Arm the fallback before anything can throw. Some browsers and some
    // locked-down networks refuse to build a peer connection at all — that
    // must end in the relay, not in a dead link.
    this.timer = setTimeout(() => {
      if (this.mode !== 'direct') this.fallback('no direct route found');
    }, 9000);

    try {
      this.pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    } catch (e) {
      this.fallback('this browser cannot open a direct connection');
      return;
    }

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal.send({ t: 'signal', to: this.peerId, data: { candidate } });
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed') this.fallback('the direct route closed');
      if (s === 'connected') this.measure();
    };

    this.pc.ondatachannel = ({ channel }) => this.attach(channel);

    if (initiator) {
      const dc = this.pc.createDataChannel('kdrop', { ordered: true });
      this.attach(dc);
      await this.negotiate();
    }
  }

  attach(dc) {
    this.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;

    dc.onopen = () => {
      // Do not move an in-flight relay stream onto a second ordered transport.
      if (this.fellBack || this.dead) { dc.close(); return; }
      clearTimeout(this.timer);
      this.mode = 'direct';
      this.emit('mode', 'direct');
      this.startKeyExchange();
      this.emit('up');
      this.measure();
    };
    dc.onclose = () => this.fallback('the direct route dropped');
    dc.onerror = () => this.fallback('the direct route errored');
    dc.onmessage = (ev) => this.incoming(ev.data);
  }

  async negotiate() {
    try {
      this.making = true;
      await this.pc.setLocalDescription();
      this.signal.send({ t: 'signal', to: this.peerId, data: { desc: this.pc.localDescription } });
    } catch (e) {
      console.warn('negotiate', e);
    } finally {
      this.making = false;
    }
  }

  /** Perfect-negotiation handling, so both sides can start at once safely. */
  async onSignal(data) {
    if (!this.pc) return;
    try {
      if (data.desc) {
        const offerCollision = data.desc.type === 'offer' && (this.making || this.pc.signalingState !== 'stable');
        this.ignoring = !this.polite && offerCollision;
        if (this.ignoring) return;
        await this.pc.setRemoteDescription(data.desc);
        if (data.desc.type === 'offer') {
          await this.pc.setLocalDescription();
          this.signal.send({ t: 'signal', to: this.peerId, data: { desc: this.pc.localDescription } });
        }
      } else if (data.candidate) {
        try { await this.pc.addIceCandidate(data.candidate); }
        catch (e) { if (!this.ignoring) throw e; }
      }
    } catch (e) {
      console.warn('signal', e);
    }
  }

  fallback(why) {
    if (this.fellBack || this.mode === 'relayed') return;
    this.fellBack = true;
    clearTimeout(this.timer);
    this.signal.send({ t: 'relay-open', to: this.peerId });
    this.signal.relayPeer = this.peerId;
    this.mode = 'relayed';
    this.emit('mode', 'relayed');
    this.startKeyExchange();
    this.emit('note', why);
    this.emit('up');
    this.measure();
  }

  async measure() {
    const t0 = performance.now();
    this.send({ t: 'ping', ts: t0 });
  }

  /* ------------------------------------------------------------ transport */

  /** Control messages — small JSON, always reliable and ordered. */
  send(obj) {
    if (this.mode === 'direct' && this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(obj));
      return true;
    }
    return this.signal.send({ t: 'ctl', to: this.peerId, data: obj });
  }

  /** Bulk bytes — encrypted first when travelling over the relay. */
  /**
   * Send bulk bytes.
   *
   * Returns undefined on the direct path rather than a promise. There is
   * nothing to await there — the browser applies DTLS itself — and making the
   * caller await a resolved promise per chunk cost an event-loop turn on every
   * single frame.
   */
  sendBytes(buf) {
    if (this.dead) throw new Error('link closed');

    if (this.mode === 'direct' && this.dc) {
      if (this.dc.readyState !== 'open') throw new Error('data channel not open');
      this.dc.send(buf);
      return undefined;
    }
    return this.sendBytesEncrypted(buf);
  }

  /** Wait briefly for the exchange to finish; it happens as the link opens. */
  async waitForKey(ms = 8000) {
    if (this.key) return this.key;
    const end = Date.now() + ms;
    while (!this.key && Date.now() < end && !this.dead) await sleep(60);
    return this.key;
  }

  async sendBytesEncrypted(view) {
    // WebCrypto must be given exactly the bytes to encrypt; a view into a
    // larger buffer would encrypt the wrong range, so copy for this path only.
    const buf = ArrayBuffer.isView(view)
      ? view.slice().buffer
      : view;

    // Defence in depth. The UI requires a PIN before joining, but if a key is
    // ever missing we stop rather than quietly pushing plaintext through the
    // relay. Failing loudly is the only safe behaviour here.
    if (!this.key) await this.waitForKey();
    if (!this.key) {
      // Either the PIN is wrong, or the other device is running an older
      // version that agrees keys differently. Both are fixed by reloading,
      // and neither is a reason to send plaintext.
      this.emit('note', 'stale');
      throw new Error('no session key — the other device may need to reload');
    }
    const encrypted = await seal(this.key, buf);
    // Relay routing is socket-wide; another peer joining must not redirect a file.
    if (this.signal.relayPeer !== this.peerId) {
      if (!this.signal.send({t: 'relay-open', to: this.peerId})) throw new Error('relay socket not open');
      this.signal.relayPeer = this.peerId;
    }
    if (!this.signal.sendBinary(encrypted)) {
      throw new Error('relay socket not open');
    }
  }

  get buffered() {
    return this.mode === 'direct' && this.dc ? this.dc.bufferedAmount : this.signal.bufferedAmount;
  }

  /**
   * How large a frame to send.
   *
   * maxMessageSize often reports 256 KB, but frames that large tear the
   * channel down mid-transfer, so 64 KB is the ceiling regardless.
   *
   * The negotiated SCTP maximum is respected. Queue backpressure and the
   * receiver window limit in-flight data without shrinking every frame.
   */
  get chunkSize() {
    if (this.mode !== 'direct') return WS_CHUNK;

    const max = this.pc && this.pc.sctp && this.pc.sctp.maxMessageSize;
    if (!max) return DC_CHUNK_SAFE;

    // Backpressure controls the queue; shrinking frames adds CPU overhead.
    // Also honor peers whose negotiated maximum is smaller than 16 KB.
    return Math.max(1, Math.min(DC_CHUNK, Math.floor(max)));
  }

  /** Wait until the pipe has drained enough to keep pushing. */
  /**
   * Wait only if the pipe is actually backed up.
   *
   * Returns undefined — not a promise — in the common case, so the caller can
   * skip awaiting entirely. An await on every chunk costs an event-loop turn
   * each time, and at thousands of frames per second that alone dominates.
   */
  drain() {
    if (this.buffered <= HIGH_WATER) return undefined;

    return new Promise((resolve, reject) => {
      const dc = this.mode === 'direct' ? this.dc : null;
      const started = Date.now();
      const cleanup = () => {
        clearInterval(poll);
        if (dc) dc.removeEventListener('bufferedamountlow', check);
      };
      const check = () => {
        if (this.dead || (dc && dc.readyState !== 'open') || (!dc && !this.signal.ready)) {
          cleanup(); reject(new Error('Connection closed while sending')); return;
        }
        if (this.buffered <= LOW_WATER) { cleanup(); resolve(); return; }
        if (Date.now() - started > 30000) {
          cleanup(); reject(new Error('Connection stopped draining')); return;
        }
      };
      const poll = setInterval(check, 50);
      if (dc) dc.addEventListener('bufferedamountlow', check);
      check();
    });
  }

  incoming(data) {
    if (typeof data === 'string') {
      let m; try { m = JSON.parse(data); } catch { return; }
      return this.control(m);
    }
    // Direct chunks need no decryption, but still go through the same queue so
    // a slow disk write cannot let the next chunk overtake it.
    this.inbound = (this.inbound || Promise.resolve())
      .then(() => this.deliver(data))
      .catch((e) => console.warn('inbound', e));
  }

  /**
   * Bytes arriving over the relay path.
   *
   * Decryption is asynchronous, and independent decrypt calls do not
   * necessarily settle in the order they were started. Chaining them onto a
   * single promise keeps chunks in the order the sender wrote them — without
   * this, a file arrives complete but scrambled.
   */
  relayBytes(buf) {
    this.inbound = (this.inbound || Promise.resolve())
      .then(async () => {
        if (!this.key) {
          this.emit('note', 'discarded relayed data that arrived without encryption');
          return;
        }
        try {
          return await this.deliver(await open(this.key, buf));
        } catch {
          this.emit('note', 'a chunk failed to decrypt — check the PIN');
        }
      })
      .catch((e) => console.warn('inbound', e));
    return this.inbound;
  }

  /** Hand bytes up, and wait if the consumer is writing them to disk. */
  deliver(buf) {
    if (this.dead) return;
    const waits = [];
    this.dispatchEvent(new CustomEvent('bytes', { detail: { buf, hold: (p) => waits.push(p) } }));
    return waits.length ? Promise.all(waits) : undefined;
  }

  control(m) {
    if (m.t === 'ping') return this.send({ t: 'pong', ts: m.ts });
    if (m.t === 'kx') return this.onKeyExchange(m);
    if (m.t === 'pong') {
      this.rtt = Math.round(performance.now() - m.ts);
      this.emit('rtt', this.rtt);
      return;
    }
    // "end of file" must not be handled before the last chunk of that file,
    // so control messages join the same queue the bytes are waiting in.
    this.inbound = (this.inbound || Promise.resolve())
      .then(() => {
        if (this.dead) return;
        const waits = [];
        this.dispatchEvent(new CustomEvent('ctl', { detail: { msg: m, hold: (p) => waits.push(p) } }));
        return waits.length ? Promise.all(waits) : undefined;
      })
      .catch((e) => console.warn('ctl', e));
  }

  close() {
    // Anything still sitting in this link's inbound queue must not be counted
    // after it closes. A resume asks the receiver how many bytes it holds, and
    // a late chunk landing after that answer puts the two sides out of step.
    this.dead = true;
    clearTimeout(this.timer);
    this.signal.send({ t: 'relay-close' });
    try { this.dc && this.dc.close(); } catch {}
    try { this.pc && this.pc.close(); } catch {}
    this.mode = 'down';
    this.emit('mode', 'down');
  }
}

/* ========================================================= transfer engine */

let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

/**
 * Drives one batch of files across a Link, chunk by chunk, reporting progress.
 * Reads the source in large slices but writes to the wire in small frames,
 * pausing whenever the pipe backs up.
 */
export class Sender extends EventTarget {
  constructor(link, files) {
    super();
    this.link = link;
    this.files = [...files];
    this.bid = nextId();
    this.cancelled = false;
    this.total = this.files.reduce((n, f) => n + f.size, 0);
    this.sent = 0;
    this.rate = 0;
    this.startedAt = 0;
    this.paused = false;
    this.inflight = null;          // { file, meta, offset } while a file is moving
    this.sentBeforeCurrent = 0;    // bytes confirmed for files already finished
    this.doneFids = new Set();
    this.settled = false;      // true once done, failed or cancelled
    this.resuming = false;
    this.resumeAttempts = 0;
    this._wake = null;
    this._ticker = null;
    this.receiptTimeout = 30000;
    this.receipts = new Map();
    this.confirmed = 0;
    this.receiverOffset = 0;
    this.generation = 0;
    this.remoteDone = new Set();
  }

  /**
   * Emit a terminal event exactly once.
   *
   * When a transfer resumes, the original attempt's promise chain is still
   * unwinding and will reject a moment later. Without this guard that late
   * rejection arrives after the resumed transfer has already finished, and
   * overwrites a completed transfer with a failure.
   */
  settle(type, detail) {
    if (this.settled) return false;
    this.settled = true;
    this.stopTicker();
    if (type === 'failed') { try { this.link.send({t: 'cancel', bid: this.bid}); } catch {} }
    for (const pending of this.receipts.values()) pending.reject(new Error('Transfer ended'));
    this.receipts.clear();
    if (this._flowWake) this._flowWake();
    this.emit(type, detail);
    return true;
  }

  /** Non-terminal: only meaningful while the transfer is still live. */
  emitIfLive(type, detail) {
    if (this.settled) return;
    this.emit(type, detail);
  }

  emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
  on(t, fn) { this.addEventListener(t, (e) => fn(e.detail)); return this; }

  manifest() {
    return this.files.map((f, i) => ({
      fid: `${this.bid}.${i}`,
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
      rel: f.webkitRelativePath || '',
    }));
  }

  /** Ask the other side first. Nothing moves until a human says yes. */
  ask() {
    this.link.send({ t: 'batch', bid: this.bid, files: this.manifest(), total: this.total, receipts: 1 });
    this.emit('asked');
  }

  cancel() {
    this.cancelled = true;
    this.play();
    this.link.send({ t: 'cancel', bid: this.bid });
    this.settle('cancelled');
  }

  startTicker() {
    if (this._ticker) return;
    let last = performance.now();
    let lastBytes = this.sent;
    this._ticker = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      if (dt > 0) {
        const inst = (this.sent - lastBytes) / dt;
        this.rate = this.rate ? this.rate * 0.72 + inst * 0.28 : inst;
        last = now;
        lastBytes = this.sent;
      }
      if (!this.lastPing || now - this.lastPing >= 5000) { this.lastPing = now; this.link.measure?.(); }
      this.emit('progress', this.snapshot());
    }, 220);
  }

  stopTicker() { clearInterval(this._ticker); this._ticker = null; }

  async run() {
    this.startedAt = performance.now();
    this.startTicker();
    try {
      await this.continueFrom(0);
    } catch (e) {
      // A link failure here is not fatal — the app will call
      // resumeAfterReconnect() once a connection is back.
      if (!e.superseded) this.emitIfLive('interrupted', e);
    }
  }

  /** Send files from index i onwards, then close out the batch. */
  async continueFrom(i) {
    const man = this.manifest();
    for (let k = Math.max(i, 0); k < this.files.length; k++) {
      if (this.cancelled || this.settled) break;
      if (this.doneFids.has(man[k].fid)) continue;
      this.sentBeforeCurrent = man.slice(0, k).reduce((n, m) => n + m.size, 0);
      await this.one(this.files[k], man[k]);
    }
    if (!this.cancelled && !this.settled && this.doneFids.size === this.files.length) {
      await this.requestReceipt('batch-ack', this.bid, { t: 'bdone', bid: this.bid });
      this.emit('progress', this.snapshot());
      this.settle('done', this.snapshot());
    }
  }

  async one(file, meta, startAt = 0) {
    const SLICE = 4 * 1024 * 1024;
    const attempt = ++this.generation;
    const checkAttempt = () => {
      if (attempt !== this.generation) throw Object.assign(new Error('Superseded transfer attempt'), {superseded:true});
    };

    // Remember what is in flight so a dropped connection can pick it up again.
    this.inflight = { file, meta, offset: startAt };

    if (startAt > 0) {
      this.link.send({ t: 'fresume', fid: meta.fid, from: startAt });
    } else {
      this.link.send({ t: 'fstart', fid: meta.fid, name: meta.name, size: meta.size, type: meta.type });
    }

    // The checksum covers the whole file, so after a resume it has to be
    // rebuilt over the part already sent. Re-reading from local disk is far
    // cheaper than re-sending those bytes over the network.
    const crc = new Crc32();
    if (startAt > 0) {
      let p = 0;
      while (p < startAt) {
        const end = Math.min(p + SLICE, startAt);
        crc.update(new Uint8Array(await file.slice(p, end).arrayBuffer()));
        p = end;
      }
    }

    let offset = startAt;
    this.receiverOffset = startAt;
    let nextSlice = file.slice(offset, Math.min(offset + SLICE, file.size)).arrayBuffer();

    while (offset < file.size) {
      if (this.cancelled || this.settled) return;
      const slice = await nextSlice;
      checkAttempt();
      const nextOffset = offset + slice.byteLength;
      nextSlice = nextOffset < file.size
        ? file.slice(nextOffset, Math.min(nextOffset + SLICE, file.size)).arrayBuffer()
        : null;
      // Keep a prefetched read rejection handled even if transport fails first.
      if (nextSlice) nextSlice.catch(() => {});
      const view = new Uint8Array(slice);
      crc.update(view);

      const step = this.link.chunkSize;
      for (let p = 0; p < view.length; p += step) {
        if (this.cancelled || this.settled) return;
        if (this.paused) await this.waitWhilePaused();
        checkAttempt();
        if (this.cancelled || this.settled) return;
        if (this.inflight.offset - this.receiverOffset >= 8 * 1024 * 1024) await this.waitForReceiver(attempt);
        checkAttempt();
        if (this.cancelled || this.settled) return;
        const back = this.link.drain();
        if (back) await back;              // only when the pipe is genuinely full
        checkAttempt();

        const end = Math.min(p + step, view.length);
        // subarray, not slice: a view rather than a copy. send() copies into
        // the transport's buffer synchronously, so copying first is waste.
        const sending = this.link.sendBytes(view.subarray(p, end));
        if (sending) await sending;        // only on the encrypted relay path
        checkAttempt();

        const n = end - p;
        this.sent += n;
        this.inflight.offset += n;
      }
      offset += slice.byteLength;
    }

    checkAttempt();
    if (this.settled || this.cancelled) return;
    await this.requestReceipt('file-ack', meta.fid, { t: 'fend', fid: meta.fid, bid: this.bid, crc: crc.value });
    this.inflight = null;
    this.doneFids.add(meta.fid);
    this.emit('file-done', meta);
  }

  requestReceipt(type, id, message) {
    return new Promise((resolve, reject) => {
      const key = `${type}:${id}`;
      const cleanup = () => { clearTimeout(timer); this.receipts.delete(key); };
      const timer = setTimeout(() => {
        const error = new Error('Receiver did not confirm delivery. Keep both tabs open and reload both devices before retrying.');
        cleanup(); reject(error); this.settle('failed', error);
      }, this.receiptTimeout);
      this.receipts.set(key, {
        resolve: () => { cleanup(); resolve(); },
        reject: (error) => { cleanup(); reject(error); },
      });
      try {
        if (!this.link.send(message)) throw new Error('Connection closed before delivery confirmation');
      } catch (error) { this.receipts.get(key)?.reject(error); }
    });
  }

  onReceipt(m) {
    if (m.bid !== this.bid || this.settled) return;
    if (m.t === 'transfer-error' || m.ok === false) {
      const error = new Error(m.reason || 'The receiving device could not save this transfer');
      this.settle('failed', error); return;
    }
    if (m.t === 'file-progress' && this.inflight && m.fid === this.inflight.meta.fid) {
      if (!Number.isSafeInteger(m.got) || m.got < this.receiverOffset || m.got > this.inflight.offset) return;
      this.receiverOffset = m.got;
      this.confirmed = this.sentBeforeCurrent + m.got;
      if (this._flowWake) this._flowWake();
      return;
    }
    if (m.t === 'file-ack' && this.inflight?.meta.fid === m.fid && m.ok === true) {
      this.confirmed = this.sentBeforeCurrent + this.inflight.file.size;
    }
    this.receipts.get(`${m.t}:${m.fid || m.bid}`)?.resolve();
  }

  async waitForReceiver(attempt) {
    const start = Date.now();
    while (attempt === this.generation && !this.cancelled && !this.settled && this.inflight && this.inflight.offset - this.receiverOffset >= 8 * 1024 * 1024) {
      if (Date.now() - start > this.receiptTimeout) {
        const error = new Error('The receiving device stopped responding. Keep its tab open and retry.');
        this.settle('failed', error); throw error;
      }
      await new Promise(resolve => {
        const wake = () => { clearTimeout(timer); this._flowWake = null; resolve(); };
        const timer = setTimeout(wake, 100);
        this._flowWake = wake;
      });
    }
  }

  /* --------------------------------------------------------- pause / resume */

  pause() { this.paused = true; this.emit('paused'); }

  play() {
    this.paused = false;
    if (this._wake) { this._wake(); this._wake = null; }
    this.emit('resumed');
  }

  waitWhilePaused() {
    return new Promise((res) => { this._wake = res; });
  }

  /**
   * Called when the link comes back after a drop. Asks the receiver how much
   * of the current file actually landed, then continues from exactly there.
   * The receiver is the authority — bytes can be lost in flight, so what the
   * sender believes it sent is an upper bound, not the truth.
   */
  async resumeAfterReconnect(link) {
    // A reconnect can raise more than one 'up' — a direct channel opening and
    // a relay falling back, or both peers re-linking. Two resume loops running
    // at once interleave their chunks and corrupt the file, so only one runs.
    if (this.resuming) return false;   // a loop already owns this attempt
    this.resuming = true;
    this.generation++;
    for (const p of this.receipts.values()) p.reject(Object.assign(new Error('Resuming'), {superseded:true}));
    if (this._flowWake) this._flowWake();
    this.resumeAttempts = (this.resumeAttempts || 0) + 1;
    try {
      return await this._resume(link);
    } finally {
      this.resuming = false;
    }
  }

  async _resume(link) {
    // Prefer a live direct link over whichever one happened to fire the event.
    // After a reconnect the relay often comes back first and is then replaced
    // by a direct channel a moment later; sending on the stale one just fails.
    this.link = this.bestLink(link);
    if (!this.inflight || this.cancelled) return false;

    const { meta } = this.inflight;
    const got = await this.askReceiverOffset(link, meta.fid);
    if (got == null) return false;

    this.sent = this.sentBeforeCurrent + got;
    this.emit('resuming', { fid: meta.fid, from: got });

    this.link = this.bestLink(this.link);
    const file = this.inflight.file;
    const nextIndex = this.files.indexOf(file) + 1;
    try {
      if (this.remoteDone.has(meta.fid)) {
        this.doneFids.add(meta.fid);
        this.inflight = null;
      } else await this.one(file, meta, got);
      await this.continueFrom(nextIndex);
      this.resumeAttempts = 0;
      return true;
    } catch (e) {
      // The link died again mid-resume. Leave `inflight` in place so the next
      // reconnect can pick up from wherever the receiver actually got to.
      if (!e.superseded) this.emitIfLive('interrupted', e);
      return false;
    }
  }

  /**
   * Ask the receiver how much of this file it actually holds.
   *
   * The answer is delivered by the app rather than listened for on a specific
   * link, because a reconnect can leave more than one link object alive and
   * the reply may arrive on whichever one connected first.
   *
   * Asked repeatedly rather than once: a link that has just come back can
   * still drop the first message while the socket settles.
   */
  askReceiverOffset(link, fid, { timeout = 12000, every = 1200 } = {}) {
    return new Promise((res) => {
      this._pendingResume = { fid, resolve: (got) => { cleanup(); res(got); } };

      const cleanup = () => {
        clearInterval(poll);
        clearTimeout(timer);
        this._pendingResume = null;
      };

      // Ask over every live link, not just the one that woke us.
      const ask = () => {
        const links = this.allLinks ? this.allLinks() : [link];
        for (const l of links) {
          if (l && !l.dead) l.send({ t: 'resume-ask', bid: this.bid, fid });
        }
      };

      ask();
      const poll = setInterval(ask, every);
      const timer = setTimeout(() => { cleanup(); res(null); }, timeout);
    });
  }

  bestLink(fallback) {
    const links = this.allLinks ? this.allLinks() : [];
    return links.find((l) => l.mode === 'direct')
        || links.find((l) => l.mode === 'relayed')
        || fallback;
  }

  /** Called by the app when a resume-at arrives on any link. */
  onResumeAt(m) {
    const p = this._pendingResume;
    if (p && m.bid === this.bid && m.fid === p.fid && Number.isSafeInteger(m.got) && m.got >= 0 && m.got <= this.inflight?.file.size) {
      if (m.complete) this.remoteDone.add(m.fid);
      p.resolve(m.got);
    }
  }

  snapshot() {
    const left = this.total - this.sent;
    return {
      bid: this.bid,
      sent: this.sent,
      confirmed: this.confirmed,
      total: this.total,
      pct: this.total ? (this.sent / this.total) * 100 : 0,
      rate: this.rate,
      eta: this.rate > 0 ? left / this.rate : Infinity,
      mode: this.link.mode,
    };
  }
}

/**
 * Assembles an incoming batch. Streams straight to disk when the browser
 * supports it, so a 40 GB file does not have to fit in memory.
 */
export class Receiver extends EventTarget {
  constructor(link, batch) {
    super();
    this.link = link;
    this.batch = batch;
    this.dirHandle = null;
    this.opfsRoot = null;
    this.memoryLimit = 128 * 1024 * 1024;
    this.current = null;
    this.received = 0;
    this.total = batch.total;
    this.rate = 0;
    this.results = [];
    this.tick = null;
    this.failed = false;
    this.lastProgress = 0;
    this.writeMs = 0;
    this.writeSamples = 0;
  }

  emit(t, d) { this.dispatchEvent(new CustomEvent(t, { detail: d })); }
  on(t, fn) { this.addEventListener(t, (e) => fn(e.detail)); return this; }

  /** Called from the click that accepts the transfer, so the picker is allowed. */
  /**
   * Ask for a folder when it will make a real difference.
   *
   * With a folder handle, each chunk is written to disk as it arrives. Without
   * one, the whole file accumulates in memory until the transfer ends — which
   * both caps the size and slows the transfer down as garbage collection
   * starts competing for time. The benchmark shows throughput falling off as
   * files grow, and this is why.
   *
   * Previously the picker only appeared for multiple files, so a single large
   * video — the exact case that needs it most — was buffered in memory.
   */
  async prepare() {
    const many = this.batch.files.length > 1;
    const large = (this.batch.total || 0) > 32 * 1024 * 1024;
    if (!many && !large) return;   // a small single file is fine in memory

    // Best case: let the person choose the real destination and stream there.
    // This API is available in Chromium-based browsers and requires a user
    // gesture, which is why prepare() is called directly from Accept.
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        this.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kdrop' });
        return;
      } catch {
        this.dirHandle = null;     // declined or unsupported permission state
      }
    }

    // Second choice: Origin Private File System. It is still disk-backed, but
    // private to the site. At the end we expose the completed File through a
    // normal Save link. This avoids holding a large video in JavaScript RAM.
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
        this.opfsRoot = await navigator.storage.getDirectory();
        return;
      }
    } catch {
      this.opfsRoot = null;
    }

    // A small transfer can safely fall back to memory. For a genuinely large
    // one, refusing before bytes start is much better than crashing near 100%.
    if ((this.batch.total || 0) > this.memoryLimit) {
      throw new Error('This browser cannot stream a transfer this large to disk. Choose a supported browser or a smaller batch.');
    }
  }

  async openWriter(c) {
    if (this.dirHandle) {
      const safe = safeFilename(c.meta.name);
      const fh = await this.dirHandle.getFileHandle(safe, { create: true });
      c.writer = await fh.createWritable();
      c.savedDirectly = true;
      return;
    }
    if (this.opfsRoot) {
      const cleanId = String(c.meta.fid || 'file').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
      c.opfsName = `kdrop-${this.batch.bid}-${cleanId || Date.now()}.part`;
      c.opfsHandle = await this.opfsRoot.getFileHandle(c.opfsName, { create: true });
      c.writer = await c.opfsHandle.createWritable();
    }
  }

  begin() {
    let last = performance.now();
    let lastBytes = 0;
    if (this.batch.receipts === 1) this.flowTick = setInterval(() => {
      const c = this.current;
      if (c && !this.failed) this.link.send({t: 'file-progress', bid: this.batch.bid, fid: c.meta.fid, got: c.got});
    }, 100);
    this.tick = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      if (dt > 0) {
        const inst = (this.received - lastBytes) / dt;
        this.rate = this.rate ? this.rate * 0.72 + inst * 0.28 : inst;
        last = now;
        lastBytes = this.received;
      }
      this.emit('progress', this.snapshot());
    }, 220);
  }

  async onControl(m) {
    if (this.failed) return;
    if (m.t === 'fstart') {
      this.current = { meta: m, crc: new Crc32(), got: 0, parts: [], writer: null };
      try {
        // Remote input is sanitised by openWriter() before it can reach a real
        // file-system destination. OPFS names never use the remote filename.
        await this.openWriter(this.current);
      } catch (error) { this.fail(error); return; }
      this.emit('file-start', m);
    }

    // The sender is asking how much of this file actually arrived. We are the
    // only side that knows — bytes can be lost after the sender let go of them.
    if (m.t === 'resume-ask') {
      const complete = this.results.find(r => r.meta.fid === m.fid && r.ok);
      const got = complete ? complete.meta.size : this.current && this.current.meta.fid === m.fid ? this.current.got : 0;
      this.link.send({ t: 'resume-at', bid: m.bid, fid: m.fid, got, complete: Boolean(complete) });
      this.emit('resume-asked', { fid: m.fid, got });
    }

    // Sending continues from an agreed offset. Keep whatever we already have;
    // recreating `current` here would silently throw away the partial file.
    if (m.t === 'fresume') {
      if (this.current && this.current.meta.fid === m.fid) {
        // The sender should be continuing from exactly what we reported. If it
        // is not, our copy and its copy disagree and appending would silently
        // corrupt the file — so start this file over instead.
        if (m.from !== this.current.got) {
          this.emit('note', 'resume offsets disagreed — restarting this file');
          if (this.current.writer) { try { await this.current.writer.abort(); } catch {} }
          this.received -= this.current.got;
          this.current = { meta: this.current.meta, crc: new Crc32(), got: 0, parts: [], writer: null };
          try { await this.openWriter(this.current); } catch (error) { this.fail(error); return; }
          if (m.from !== 0) this.link.send({ t: 'resume-at', bid: m.bid, fid: m.fid, got: 0 });
        } else {
          this.emit('resuming', { fid: m.fid, from: m.from });
        }
      } else {
        // We have nothing for this file — treat it as a fresh start.
        this.current = { meta: { fid: m.fid, name: m.name || 'file', size: m.size || 0 },
                         crc: new Crc32(), got: 0, parts: [], writer: null };
        try { await this.openWriter(this.current); } catch (error) { this.fail(error); return; }
      }
    }

    if (m.t === 'fend') await this.finish(m);

    if (m.t === 'bdone') {
      if (this.current || this.results.length !== this.batch.files.length || this.results.some(r => !r.ok)) {
        this.fail(new Error('Not all files arrived intact')); return;
      }
      this.link.send({ t: 'batch-ack', bid: this.batch.bid, ok: true });
      clearInterval(this.tick);
      clearInterval(this.flowTick);
      this.emit('progress', this.snapshot());
      this.emit('done', this.results);
    }

    if (m.t === 'cancel') {
      clearInterval(this.tick);
      clearInterval(this.flowTick);
      if (this.current?.writer) { try { await this.current.writer.abort(); } catch {} }
      this.emit('cancelled');
    }
  }

  fail(error) {
    if (this.failed) return;
    this.failed = true;
    clearInterval(this.tick);
    clearInterval(this.flowTick);
    if (this.current?.writer) this.current.writer.abort().catch(() => {});
    this.link.send({ t: 'transfer-error', bid: this.batch.bid,
      reason: 'The receiving device could not write or verify the file. Check available storage and retry.' });
    this.emit('failed', error);
  }

  async flush(c) {
    if (!c.writer || !c.parts.length) return;
    const parts = c.parts;
    c.parts = [];
    c.pendingBytes = 0;
    // One write per MiB instead of one per 16–64 KB frame.
    const started = performance.now();
    try { await c.writer.write(new Blob(parts)); }
    finally { this.writeMs += performance.now() - started; this.writeSamples++; }
  }

  async onBytes(buf) {
    const c = this.current;
    if (!c || this.failed) return;
    const view = new Uint8Array(buf);
    if (c.got + view.length > c.meta.size) {
      this.fail(new Error('Received more data than the file declares')); return;
    }
    try {
      c.parts.push(view);
      c.pendingBytes = (c.pendingBytes || 0) + view.length;
      if (c.writer && c.pendingBytes >= 1024 * 1024) await this.flush(c);
      c.crc.update(view);
      c.got += view.length;
      this.received += view.length;
      if (this.batch.receipts === 1 && this.link.mode === 'direct' && c.got - (c.lastAck || 0) >= 1024 * 1024) {
        c.lastAck = c.got;
        this.link.send({t: 'file-progress', bid: this.batch.bid, fid: c.meta.fid, got: c.got});
      }
    } catch (error) { this.fail(error); }
  }

  async finish(m) {
    const c = this.current;
    if (!c || this.failed) return;
    if (c.meta.fid !== m.fid || c.crc.value !== m.crc || c.got !== c.meta.size) {
      this.fail(new Error('File size or checksum did not match')); return;
    }
    try {
      let result;
      if (c.writer) {
        await this.flush(c);
        await c.writer.close();
        if (c.opfsHandle) {
          const file = await c.opfsHandle.getFile();
          const url = URL.createObjectURL(file);
          result = {
            meta: c.meta, ok: true, saved: false, url, storage: 'opfs',
            cleanup: async () => {
              try { URL.revokeObjectURL(url); } catch {}
              try { await this.opfsRoot?.removeEntry(c.opfsName); } catch {}
            },
          };
          // Do not leave browser-private temporary files forever when the user
          // forgets to click Save. The object URL remains valid until cleanup.
          setTimeout(() => result.cleanup(), 60 * 60 * 1000);
        } else {
          result = { meta: c.meta, ok: true, saved: true };
        }
      } else {
        const blob = new Blob(c.parts, { type: c.meta.type || 'application/octet-stream' });
        result = { meta: c.meta, ok: true, saved: false, url: URL.createObjectURL(blob), storage: 'memory' };
      }
      c.parts = [];
      this.results.push(result);
      this.current = null;
      this.link.send({ t: 'file-ack', bid: this.batch.bid, fid: m.fid, ok: true });
      this.emit('file-done', result);
    } catch (error) { this.fail(error); }
  }

  snapshot() {
    const left = this.total - this.received;
    return {
      received: this.received,
      writeMs: this.writeMs,
      writeSamples: this.writeSamples,
      total: this.total,
      pct: this.total ? (this.received / this.total) * 100 : 0,
      rate: this.rate,
      eta: this.rate > 0 ? left / this.rate : Infinity,
      mode: this.link.mode,
    };
  }
}

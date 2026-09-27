/**
 * Trusted devices.
 *
 * The annoying part of K-Drop is not pairing once — it is being asked to
 * approve every transfer from a laptop you own and have approved thirty times.
 *
 * The naive version of this feature is to remember a device name and skip the
 * prompt when it appears again. That is not a feature, it is a hole: names are
 * chosen by the other side, so anyone can call themselves "Om's Laptop".
 *
 * So trust is bound to a secret instead. On the first pairing the two devices
 * agree a random 256-bit value that neither the server nor anyone else ever
 * sees. To be recognised later, a device must prove it holds that secret by
 * answering a fresh challenge with an HMAC. A name alone proves nothing.
 *
 * Everything here stays in the browser. The server has no idea any of it is
 * happening, and there is nothing about it to store server-side.
 */

const KEY = 'kdrop.trusted.v1';
const MAX = 20;

const te = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ------------------------------------------------------------- storage */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];   // private mode, quota, or corrupted — behave as empty
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* Trust is a convenience. Losing it costs a tap, not a transfer. */
  }
}

export function all() {
  return load().map(({ id, name, addedAt, lastSeen, autoAccept }) =>
    ({ id, name, addedAt, lastSeen, autoAccept }));   // never hand out the secret
}

export function count() { return load().length; }

export function forget(id) {
  save(load().filter((d) => d.id !== id));
}

export function forgetAll() {
  try { localStorage.removeItem(KEY); } catch {}
}

export function setAutoAccept(id, on) {
  const list = load();
  const d = list.find((x) => x.id === id);
  if (d) { d.autoAccept = Boolean(on); save(list); }
}

/* --------------------------------------------------------------- crypto */

/** This browser's own identity. Random, local, and meaningless elsewhere. */
export function selfId() {
  let id = null;
  try { id = localStorage.getItem('kdrop.deviceId'); } catch {}
  if (!id) {
    id = toHex(crypto.getRandomValues(new Uint8Array(8)));
    try { localStorage.setItem('kdrop.deviceId', id); } catch {}
  }
  return id;
}

function newSecret() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function hmac(secretHex, message) {
  const key = await crypto.subtle.importKey(
    'raw', te.encode(secretHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return toHex(await crypto.subtle.sign('HMAC', key, te.encode(message)));
}

/**
 * Compare two hex strings without leaking where they diverge through timing.
 * Overkill for a local check, cheap enough to do anyway.
 */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------------------------------------------------------- trust */

/** Record a device after both sides agreed a secret. */
export function remember(id, name, secret, { autoAccept = true } = {}) {
  if (!id || !secret) return false;
  const list = load().filter((d) => d.id !== id);
  list.unshift({
    id,
    name: String(name || 'Device').slice(0, 40),
    secret,
    autoAccept,
    addedAt: Date.now(),
    lastSeen: Date.now(),
  });
  save(list);
  return true;
}

export function isKnown(id) {
  return load().some((d) => d.id === id);
}

export function secretFor(id) {
  const d = load().find((x) => x.id === id);
  return d ? d.secret : null;
}

export function touch(id, name) {
  const list = load();
  const d = list.find((x) => x.id === id);
  if (!d) return;
  d.lastSeen = Date.now();
  if (name) d.name = String(name).slice(0, 40);
  save(list);
}

export function shouldAutoAccept(id) {
  const d = load().find((x) => x.id === id);
  return Boolean(d && d.autoAccept);
}

/* ------------------------------------------------------- challenge flow */

export function newChallenge() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Answer a challenge from a device that thinks it knows us.
 * Returns null when we hold no secret for it — silence is the right answer.
 */
export async function answer(theirId, challenge) {
  const secret = secretFor(theirId);
  if (!secret) return null;
  return hmac(secret, `${challenge}:${selfId()}`);
}

/**
 * Check an answer.
 *
 * A device is only trusted if it produced an HMAC over a challenge WE chose,
 * using a secret only the two of us hold. Replaying an old answer fails
 * because the challenge is new every time.
 */
export async function verify(theirId, challenge, response) {
  const secret = secretFor(theirId);
  if (!secret || typeof response !== 'string') return false;
  const expected = await hmac(secret, `${challenge}:${theirId}`);
  return sameSecret(expected, response);
}

/** Both sides derive the same secret from a value one of them proposed. */
export function proposeSecret() { return newSecret(); }

/** Is trust usable at all here? crypto.subtle needs a secure context. */
export function available() {
  return Boolean(window.crypto && crypto.subtle && window.isSecureContext);
}

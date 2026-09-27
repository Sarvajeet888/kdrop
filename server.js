/**
 * K-Drop — signaling + relay server
 * A free file transfer tool by Kalman.
 *
 * The server does three small things and nothing else:
 *   1. Serves the static client from /public
 *   2. Introduces two browsers to each other (WebRTC signalling)
 *   3. Relays encrypted bytes ONLY when a direct connection is impossible
 *
 * It never writes a file to disk. Nothing is stored. Rooms live in memory
 * and disappear the moment the last device leaves.
 */

'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 30 * 60 * 1000); // 30 min
const MAX_PEERS = Number(process.env.MAX_PEERS || 8);
const HEARTBEAT_MS = 25_000;

// Abuse and cost controls. Direct transfers cost us nothing, but relayed ones
// spend our bandwidth, so the relay is the thing that needs a ceiling.
const MAX_RELAY_BYTES = Number(process.env.MAX_RELAY_BYTES || 2 * 1024 * 1024 * 1024); // 2 GB per session
const MAX_SOCKETS_PER_IP = Number(process.env.MAX_SOCKETS_PER_IP || 16);
const MAX_ROOMS_PER_IP = Number(process.env.MAX_ROOMS_PER_IP || 30);   // per hour
const MAX_ROOMS_TOTAL = Number(process.env.MAX_ROOMS_TOTAL || 5000);
const MAX_JOIN_FAILS = Number(process.env.MAX_JOIN_FAILS || 20);      // wrong codes per hour
const MAX_MSGS_PER_10S = Number(process.env.MAX_MSGS_PER_10S || 200); // control-message burst
const MAX_SESSION_MS = Number(process.env.MAX_SESSION_MS || 6 * 60 * 60 * 1000);
const BAN_MS = Number(process.env.BAN_MS || 15 * 60 * 1000);

// Ambiguous characters removed so a code is readable off a screen across a room.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

// A public site gets scanned within hours of going live. These headers cost
// nothing and close the easy doors.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), interest-cohort=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
      "font-src 'self' https://cdn.fontshare.com https://api.fontshare.com",
      "img-src 'self' data: blob:",
      // blob: is needed for received files — those URLs are created by our own
      // code in the user's browser and never leave it.
      "connect-src 'self' ws: wss: blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "worker-src 'self'",           // the offline shell service worker
      "form-action 'self'",
    ].join('; ')
  );
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/sw\.js$/.test(filePath)) {
        // Never cache the service worker itself, or a bad one sticks forever.
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (/\.(png|svg|ico|woff2?|mp4)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

/* ------------------------------------------------------------------ rooms */

/** @type {Map<string, {code:string, created:number, lastActivity:number, peers:Map<string,object>}>} */
const rooms = new Map();

function newCode(len = 6) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function freshCode() {
  let code;
  do {
    code = newCode();
  } while (rooms.has(code));
  return code;
}

function roomSummary(room, exceptId) {
  return [...room.peers.values()]
    .filter((p) => p.id !== exceptId)
    .map((p) => ({ id: p.id, name: p.name, kind: p.kind }));
}

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function touchRoom(room) { if (room) room.lastActivity = Date.now(); }

function broadcast(room, obj, exceptId) {
  for (const peer of room.peers.values()) {
    if (peer.id !== exceptId) send(peer.ws, obj);
  }
}

function dropPeer(peer) {
  const room = rooms.get(peer.code);
  if (!room) return;
  room.peers.delete(peer.id);
  broadcast(room, { t: 'peer-left', id: peer.id });
  if (room.peers.size === 0) rooms.delete(peer.code);
}

// Sweep out rooms nobody came back to.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - (room.lastActivity || room.created) > ROOM_TTL_MS) {
      broadcast(room, { t: 'expired' });
      for (const p of room.peers.values()) p.ws.close(4000, 'room expired');
      rooms.delete(code);
    }
  }
}, 60_000).unref();

/* ------------------------------------------------------------ observability */

const startedAt = Date.now();
const stats = {
  roomsCreated: 0,
  peersJoined: 0,
  relayBytes: 0,
  relayCutoffs: 0,
  rateLimited: 0,
  socketsRefused: 0,
  bans: 0,
  floods: 0,
  badMessages: 0,

  // Transfer outcomes. The server is not in the path of a direct transfer, so
  // without these it cannot tell whether the product works at all — only that
  // people paired. Each is a bare counter: the report carries nothing but
  // which counter to increment. No identifier, no size, no filename, nothing
  // that distinguishes one person's transfer from another's.
  transfersOk: 0,
  transfersFailed: 0,
  transfersDirect: 0,
  transfersRelayed: 0,
  transfersResumed: 0,
  errors: 0,
};

const LOG_JSON = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

/** One line per event. JSON in production so a log search can parse it. */
function log(level, event, data = {}) {
  if (LOG_JSON) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
  } else {
    const extra = Object.keys(data).length ? ' ' + JSON.stringify(data) : '';
    console.log(`${new Date().toISOString().slice(11, 19)}  ${level.padEnd(5)} ${event}${extra}`);
  }
}

// A heartbeat line every five minutes gives you a load history for free —
// enough to see a spike without paying for a monitoring service.
setInterval(() => {
  const verdict = assess();
  if (verdict.status !== 'healthy') {
    for (const a of verdict.alerts) log(a.level === 'high' ? 'error' : 'warn', 'alert', a);
  }
  log('info', 'heartbeat', {
    rooms: rooms.size,
    peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    upMin: Math.round((Date.now() - startedAt) / 60000),
    relayMb: Math.round(stats.relayBytes / 1048576),
  });
}, 300_000).unref();

// Never die silently. Log the reason, then let the platform restart us.
process.on('uncaughtException', (err) => {
  stats.errors++;
  log('fatal', 'uncaught', { message: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 200);
});
process.on('unhandledRejection', (reason) => {
  stats.errors++;
  log('error', 'unhandled-rejection', { reason: String(reason) });
});

/* ------------------------------------------------------------ rate limits */

/** @type {Map<string, {sockets:number, rooms:number[]}>} */
const perIp = new Map();

/**
 * The client address, safely.
 *
 * x-forwarded-for is a list that each proxy APPENDS to, so the rightmost
 * entries are the ones added by infrastructure we control and the leftmost is
 * whatever the client sent. Reading the first entry lets anyone spoof it and
 * walk straight past every rate limit by rotating fake values.
 *
 * We count TRUST_PROXY_HOPS in from the right instead. With one proxy in front
 * (Render, Railway, Fly, nginx) the default of 1 is correct. With Cloudflare in
 * front of that, set it to 2. Set it to 0 when there is no proxy at all, and
 * the header is ignored entirely.
 */
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);

function ipOf(req) {
  const direct = normaliseIp(req.socket.remoteAddress || '');
  if (TRUST_PROXY_HOPS <= 0) return direct;

  const raw = req.headers['x-forwarded-for'];
  if (!raw) return direct;

  const chain = String(raw).split(',').map((x) => x.trim()).filter(Boolean);
  if (!chain.length) return direct;

  // One hop back from the right is the address our own proxy observed.
  const idx = chain.length - TRUST_PROXY_HOPS;
  const candidate = chain[idx >= 0 ? idx : 0];
  return normaliseIp(candidate) || direct;
}

function normaliseIp(ip) {
  let v = String(ip).trim();
  if (v.startsWith('::ffff:')) v = v.slice(7);       // IPv4 inside IPv6
  const port = v.lastIndexOf(':');
  if (port > -1 && v.indexOf(':') === port) v = v.slice(0, port);   // strip :port
  // Group IPv6 clients by their /64, since a single user often has many.
  if (v.includes(':')) v = v.split(':').slice(0, 4).join(':');
  return v;
}

/**
 * A short, non-reversible label for an address, for logs.
 *
 * Abuse handling needs to say "this is the same source again" without writing
 * anyone's IP address to a log file that the hosting platform retains for
 * days. The salt is random per process and never stored, so the labels are
 * meaningless the moment the server restarts and cannot be matched back to a
 * person even by us.
 */
const IP_SALT = crypto.randomBytes(16);

function ipLabel(ip) {
  return crypto.createHash('sha256').update(IP_SALT).update(String(ip)).digest('hex').slice(0, 8);
}

function ipRecord(ip) {
  let r = perIp.get(ip);
  if (!r) { r = { sockets: 0, rooms: [], joinFails: [], bannedUntil: 0 }; perIp.set(ip, r); }
  return r;
}

function isBanned(ip) {
  const r = perIp.get(ip);
  return Boolean(r && r.bannedUntil > Date.now());
}

/** A short cool-off, not a permanent block — most abuse is a script, not a person. */
function ban(ip, why) {
  const r = ipRecord(ip);
  r.bannedUntil = Date.now() + BAN_MS;
  stats.bans++;
  log('warn', 'ip-banned', { source: ipLabel(ip), why, minutes: Math.round(BAN_MS / 60000) });
}

/**
 * Guessing room codes is the one way in from outside. Six characters from a
 * 31-character alphabet is about 887 million combinations, so guessing is
 * hopeless — but a script can still generate load trying. Repeated failures
 * from one address earn a cool-off.
 */
function noteJoinFail(ip) {
  const r = ipRecord(ip);
  const cutoff = Date.now() - 3_600_000;
  r.joinFails = r.joinFails.filter((t) => t > cutoff);
  r.joinFails.push(Date.now());
  if (r.joinFails.length > MAX_JOIN_FAILS) ban(ip, 'room-code guessing');
}

function mayCreateRoom(ip) {
  if (rooms.size >= MAX_ROOMS_TOTAL) return false;
  const r = ipRecord(ip);
  const cutoff = Date.now() - 3_600_000;
  r.rooms = r.rooms.filter((t) => t > cutoff);
  if (r.rooms.length >= MAX_ROOMS_PER_IP) return false;
  r.rooms.push(Date.now());
  return true;
}

// Forget IPs that have gone quiet, so the map cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 3_600_000;
  for (const [ip, r] of perIp) {
    r.rooms = r.rooms.filter((t) => t > cutoff);
    if (r.sockets <= 0 && r.rooms.length === 0) perIp.delete(ip);
  }
}, 300_000).unref();

/* --------------------------------------------------------------- REST api */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
    uptime: Math.round(process.uptime()),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  });
});

/**
 * Operational metrics. Not public.
 *
 * Room counts, relay bytes and tracked-IP counts tell an attacker how loaded
 * the service is and whether their probing is working. Set METRICS_TOKEN and
 * pass it as ?token= or an Authorization: Bearer header. With no token set,
 * the endpoint is only reachable from localhost.
 */
app.get('/api/metrics', (req, res) => {
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const given = req.query.token
      || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!given || !safeEqual(String(given), token)) {
      return res.status(404).send('not found');   // 404, not 403 — don't confirm it exists
    }
  } else if (!isLocal(req)) {
    return res.status(404).send('not found');
  }
  return sendMetrics(res);
});

function isLocal(req) {
  const ip = normaliseIp(req.socket.remoteAddress || '');
  return ip === '127.0.0.1' || ip === '1' || ip === '::1' || ip === 'localhost';
}

function safeEqual(a, b) {
  const A = Buffer.from(a), B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * Turn the counters into a verdict.
 *
 * A page of numbers requires you to know what normal looks like. These
 * thresholds encode that, so a glance answers "is anything wrong" without
 * remembering what 40 relay cutoffs means.
 */
function assess() {
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  const uptimeH = process.uptime() / 3600;
  const relayGb = stats.relayBytes / 1073741824;

  const alerts = [];

  if (stats.errors > 0) {
    alerts.push({ level: 'high', what: 'crashes', detail: `${stats.errors} unhandled error(s) — check the logs` });
  }
  // Render's smallest instances have 512 MB; climbing past 400 is worth
  // knowing about before the platform kills the process.
  if (rssMb > 400) alerts.push({ level: 'high', what: 'memory', detail: `${rssMb}MB resident` });
  else if (rssMb > 250) alerts.push({ level: 'watch', what: 'memory', detail: `${rssMb}MB resident` });

  // The relay is the only part that costs money.
  if (uptimeH > 0.5 && relayGb / uptimeH > 5) {
    alerts.push({ level: 'high', what: 'relay bandwidth', detail: `${(relayGb / uptimeH).toFixed(1)} GB/hour` });
  }
  if (stats.relayCutoffs > 0) {
    alerts.push({ level: 'watch', what: 'relay cutoffs', detail: `${stats.relayCutoffs} session(s) hit the ceiling` });
  }

  // A lot of rate limiting usually means TRUST_PROXY_HOPS is wrong and every
  // visitor looks like one address — far more common than real abuse.
  if (stats.rateLimited > 20) {
    alerts.push({ level: 'watch', what: 'rate limiting', detail: `${stats.rateLimited} refusals — check TRUST_PROXY_HOPS` });
  }
  if (stats.bans > 5) {
    alerts.push({ level: 'watch', what: 'blocks', detail: `${stats.bans} source(s) cooled off` });
  }

  // Sessions created but never joined suggest people cannot complete pairing.
  const joinRate = stats.roomsCreated ? stats.peersJoined / stats.roomsCreated : null;

  const attempted = stats.transfersOk + stats.transfersFailed;
  const successRate = attempted ? stats.transfersOk / attempted : null;
  const routed = stats.transfersDirect + stats.transfersRelayed;
  const directRate = routed ? stats.transfersDirect / routed : null;

  // The two numbers that say whether the product actually works.
  if (attempted > 20 && successRate !== null && successRate < 0.9) {
    alerts.push({ level: 'high', what: 'transfer success',
      detail: `${Math.round(successRate * 100)}% of transfers completed` });
  }
  if (routed > 20 && directRate !== null && directRate < 0.5) {
    alerts.push({ level: 'watch', what: 'direct connections',
      detail: `only ${Math.round(directRate * 100)}% went direct — TURN would cut relay cost` });
  }
  if (stats.roomsCreated > 50 && joinRate !== null && joinRate < 0.3) {
    alerts.push({ level: 'watch', what: 'pairing', detail: `only ${Math.round(joinRate * 100)}% of sessions got a second device` });
  }

  return {
    status: alerts.some((a) => a.level === 'high') ? 'attention'
          : alerts.length ? 'watch' : 'healthy',
    alerts,
    joinRate: joinRate === null ? null : Number(joinRate.toFixed(2)),
    transferSuccessRate: successRate === null ? null : Number(successRate.toFixed(3)),
    directConnectionRate: directRate === null ? null : Number(directRate.toFixed(3)),
    relayGbPerHour: uptimeH > 0 ? Number((relayGb / uptimeH).toFixed(2)) : 0,
  };
}

function sendMetrics(res) {
  res.json({
    ...assess(),
    counters: { ...stats },
    rooms: rooms.size,
    peers: [...rooms.values()].reduce((n, r) => n + r.peers.size, 0),
    trackedIps: perIp.size,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    uptimeSec: Math.round(process.uptime()),
  });
}

/**
 * A public, deliberately thin status summary for the status page.
 *
 * Says whether each part is working without revealing load: exposing room
 * counts and relay bandwidth tells a prober how much effect they are having.
 * The detailed numbers stay behind /api/metrics.
 */
app.get('/api/status', (_req, res) => {
  const rss = process.memoryUsage().rss / 1048576;
  const wsUp = wss && wss.clients !== undefined;

  const components = [
    { id: 'website',   name: 'Website',        ok: true },
    { id: 'signaling', name: 'Pairing',        ok: wsUp },
    { id: 'webrtc',    name: 'Direct transfer',ok: true, note: 'runs between your devices' },
    { id: 'relay',     name: 'Fallback relay', ok: wsUp },
    { id: 'turn',      name: 'TURN',           ok: Boolean(process.env.TURN_URL && (process.env.TURN_SECRET || (process.env.TURN_USER && process.env.TURN_PASS))),
      note: process.env.TURN_URL && (process.env.TURN_SECRET || (process.env.TURN_USER && process.env.TURN_PASS)) ? '' : 'not configured — relay used instead' },
  ];

  res.set('Cache-Control', 'no-store').json({
    ok: components.every((c) => c.ok || c.id === 'turn'),
    components,
    memoryPressure: rss > 400 ? 'high' : rss > 250 ? 'moderate' : 'normal',
    uptimeSec: Math.round(process.uptime()),
    startedAt: new Date(startedAt).toISOString(),
    version: require('./package.json').version,
  });
});

app.get('/api/config', (req, res) => {
  const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }];

  // Optional TURN — only needed for transfers across different networks.
  // Prefer TURN_SECRET with coturn's REST API so browsers receive short-lived
  // credentials rather than one permanent username/password pair. Static
  // TURN_USER/TURN_PASS remains supported for providers that do not offer it.
  if (process.env.TURN_URL && process.env.TURN_SECRET) {
    const ttl = Math.max(300, Number(process.env.TURN_CREDENTIAL_TTL_SEC || 3600));
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expires}:${ipLabel(ipOf(req))}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
    ice.push({
      urls: process.env.TURN_URL.split(',').map((v) => v.trim()).filter(Boolean),
      username,
      credential,
    });
  } else if (process.env.TURN_URL && process.env.TURN_USER && process.env.TURN_PASS) {
    ice.push({
      urls: process.env.TURN_URL.split(',').map((v) => v.trim()).filter(Boolean),
      username: process.env.TURN_USER,
      credential: process.env.TURN_PASS,
    });
  }

  res.json({
    iceServers: ice,
    hasTurn: Boolean(process.env.TURN_URL && (process.env.TURN_SECRET || (process.env.TURN_USER && process.env.TURN_PASS))),
    roomTtlMs: ROOM_TTL_MS,
    version: require('./package.json').version,
  });
});

/**
 * sitemap.xml and robots.txt, generated from the request.
 *
 * These used to be written at build time with a placeholder domain that had to
 * be remembered and replaced. Deriving the host from the request means they are
 * simply correct wherever the app is deployed, with nothing to forget.
 */
function siteOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.headers.host}`;
}

const SITE_PAGES = [
  '', 'docs.html', 'security.html', 'status.html',
  'privacy.html', 'terms.html', 'acceptable-use.html', 'data-retention.html',
  'phone-to-pc.html', 'pc-to-phone.html', 'android-to-pc.html', 'iphone-to-pc.html',
  'iphone-to-windows.html', 'mac-to-android.html', 'pc-to-pc.html', 'send-large-files.html',
];

app.get('/sitemap.xml', (req, res) => {
  const origin = siteOrigin(req);
  const body = SITE_PAGES
    .map((u) => `  <url><loc>${origin}/${u}</loc><changefreq>monthly</changefreq></url>`)
    .join('\n');
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
  );
});

/**
 * Digital Asset Links — proves this site and the Android app belong together.
 *
 * Without it a Trusted Web Activity falls back to showing a browser URL bar,
 * which looks broken. The fingerprint comes from the key Google Play signs
 * your app with; set ANDROID_SHA256_FINGERPRINT once you have it from
 * Play Console → Setup → App signing.
 */
app.get('/.well-known/assetlinks.json', (_req, res) => {
  const fingerprint = process.env.ANDROID_SHA256_FINGERPRINT;
  const pkg = process.env.ANDROID_PACKAGE || 'com.kalman.kdrop';

  if (!fingerprint) {
    // Say so plainly rather than serving a file with a placeholder in it,
    // which would silently fail verification and be hard to diagnose.
    return res.status(404).json({
      error: 'not configured',
      hint: 'Set ANDROID_SHA256_FINGERPRINT (and optionally ANDROID_PACKAGE) to enable the Android app link.',
    });
  }

  res.type('application/json').json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: pkg,
      sha256_cert_fingerprints: fingerprint.split(',').map((f) => f.trim()).filter(Boolean),
    },
  }]);
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${siteOrigin(req)}/sitemap.xml\n`
  );
});

// Pairing QR codes are generated locally in the browser so the 4-character
// encryption PIN never travels to the server merely for rendering.

/* ------------------------------------------------------------- websockets */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  const rec = ipRecord(ip);

  if (isBanned(ip)) {
    ws.send(JSON.stringify({ t: 'error', reason: 'blocked' }));
    return ws.close(4009, 'temporarily blocked');
  }

  if (rec.sockets >= MAX_SOCKETS_PER_IP) {
    stats.socketsRefused++;
    log('warn', 'socket-refused', { source: ipLabel(ip), open: rec.sockets });
    ws.send(JSON.stringify({ t: 'error', reason: 'too-many' }));
    return ws.close(4008, 'too many connections');
  }
  rec.sockets++;

  const peer = {
    id: crypto.randomUUID().slice(0, 8),
    ws,
    ip,
    code: null,
    name: 'Device',
    kind: guessKind(req.headers['user-agent'] || ''),
    relayTo: null,
    relayed: 0,
    alive: true,
    openedAt: Date.now(),
    msgs: 0,
    msgWindow: Date.now(),
  };

  ws.on('pong', () => {
    peer.alive = true;
    touchRoom(peer.code && rooms.get(peer.code));
  });

  send(ws, { t: 'hello', id: peer.id });

  ws.on('message', (data, isBinary) => {
    // Binary frames are relayed straight through to one target peer.
    if (isBinary) return relay(peer, data);

    // Control messages are small by nature. Anything large claiming to be one
    // is either broken or probing, and parsing it is the expensive part.
    if (data.length > 64 * 1024) {
      stats.badMessages++;
      return;
    }

    // Burst guard. A normal session sends a handful of control messages a
    // second during setup and almost none after.
    const now = Date.now();
    if (now - peer.msgWindow > 10_000) { peer.msgWindow = now; peer.msgs = 0; }
    if (++peer.msgs > MAX_MSGS_PER_10S) {
      stats.floods++;
      ban(peer.ip, 'control-message flood');
      return ws.close(4009, 'too many messages');
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      stats.badMessages++;
      return;
    }
    // Reject anything that is not a plain object with a string type.
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
      stats.badMessages++;
      return;
    }
    handle(peer, msg);
  });

  const release = () => {
    rec.sockets = Math.max(0, rec.sockets - 1);
    dropPeer(peer);
  };
  ws.on('close', release);
  ws.on('error', release);
});

function relay(peer, data) {
  const room = peer.code && rooms.get(peer.code);
  if (!room || !peer.relayTo) return;
  touchRoom(room);

  // The relay is the only part of K-Drop that costs real money. Direct
  // transfers never touch this path, so a per-session ceiling caps the bill
  // without affecting the common case at all.
  const n = data.length || data.byteLength || 0;
  peer.relayed += n;
  stats.relayBytes += n;
  if (peer.relayed > MAX_RELAY_BYTES) {
    stats.relayCutoffs++;
    log('warn', 'relay-limit-hit', { bytes: peer.relayed });
    send(peer.ws, { t: 'relay-limit', limit: MAX_RELAY_BYTES });
    peer.relayTo = null;
    return;
  }

  const target = room.peers.get(peer.relayTo);
  if (target && target.ws.readyState === target.ws.OPEN) target.ws.send(data, { binary: true });
}

function handle(peer, msg) {
  switch (msg.t) {
    /* ---- create a room ------------------------------------------------ */
    case 'create': {
      if (!mayCreateRoom(peer.ip)) {
        stats.rateLimited++;
        log('warn', 'rate-limited', { source: ipLabel(peer.ip) });
        return send(peer.ws, { t: 'error', reason: 'rate-limited' });
      }
      if (peer.code) dropPeer(peer);
      const code = freshCode();
      const now = Date.now();
      const room = { code, created: now, lastActivity: now, peers: new Map() };
      rooms.set(code, room);
      stats.roomsCreated++;
      log('info', 'room-created', { rooms: rooms.size });

      peer.code = code;
      peer.name = clean(msg.name) || peer.name;
      room.peers.set(peer.id, peer);
      touchRoom(room);

      send(peer.ws, { t: 'room', code, id: peer.id, host: true });
      break;
    }

    /* ---- join an existing room ---------------------------------------- */
    case 'join': {
      const code = cleanCode(msg.code);
      const room = rooms.get(code);

      if (!room) {
        noteJoinFail(peer.ip);
        return send(peer.ws, { t: 'error', reason: 'no-room', code });
      }
      if (room.peers.size >= MAX_PEERS) return send(peer.ws, { t: 'error', reason: 'full' });

      if (peer.code) dropPeer(peer);
      peer.code = code;
      peer.name = clean(msg.name) || peer.name;
      room.peers.set(peer.id, peer);
      touchRoom(room);

      stats.peersJoined++;
      log('info', 'peer-joined', { peers: room.peers.size });
      send(peer.ws, { t: 'joined', code, id: peer.id, peers: roomSummary(room, peer.id) });
      broadcast(room, { t: 'peer-joined', peer: { id: peer.id, name: peer.name, kind: peer.kind } }, peer.id);
      break;
    }

    /* ---- WebRTC offer / answer / candidates ---------------------------- */
    case 'signal': {
      const room = peer.code && rooms.get(peer.code);
      if (!room) return;
      touchRoom(room);
      const target = typeof msg.to === 'string' ? room.peers.get(msg.to) : null;
      if (target) send(target.ws, { t: 'signal', from: peer.id, data: msg.data });
      break;
    }

    /* ---- fall back to server relay ------------------------------------- */
    case 'relay-open': {
      const room = peer.code && rooms.get(peer.code);
      if (!room || typeof msg.to !== 'string' || !room.peers.has(msg.to)) return;
      touchRoom(room);
      peer.relayTo = msg.to;
      send(peer.ws, { t: 'relay-ready', to: msg.to });
      break;
    }

    case 'relay-close':
      peer.relayTo = null;
      break;

    /* ---- small control messages forwarded verbatim --------------------- */
    case 'ctl': {
      const room = peer.code && rooms.get(peer.code);
      if (!room) return;
      touchRoom(room);
      const target = typeof msg.to === 'string' ? room.peers.get(msg.to) : null;
      if (target) send(target.ws, { t: 'ctl', from: peer.id, data: msg.data });
      break;
    }

    case 'rename': {
      peer.name = clean(msg.name) || peer.name;
      const room = peer.code && rooms.get(peer.code);
      if (room) { touchRoom(room); broadcast(room, { t: 'peer-renamed', id: peer.id, name: peer.name }, peer.id); }
      break;
    }

    case 'leave':
      dropPeer(peer);
      peer.code = null;
      break;

    /**
     * A finished transfer, reported as a single word.
     *
     * Deliberately not a message with fields. Anything richer — a size, a
     * duration, a session id — would make these reports about individual
     * people rather than about whether the service works, and the privacy
     * policy promises the latter.
     */
    case 'outcome': {
      const known = {
        ok: 'transfersOk',
        failed: 'transfersFailed',
        direct: 'transfersDirect',
        relayed: 'transfersRelayed',
        resumed: 'transfersResumed',
      };
      const key = known[msg.r];
      if (key) stats[key]++;
      break;
    }

    case 'ping':
      send(peer.ws, { t: 'pong', ts: msg.ts });
      break;
  }
}

/**
 * Coerce untrusted input to a short, safe string.
 *
 * String() can THROW — `{toString: 1}` has no callable toString and no
 * Symbol.toPrimitive, so converting it raises a TypeError. Anyone could send
 * that as a device name and take the whole process down, killing every other
 * user's transfer with it. Only primitives are accepted; anything else becomes
 * an empty string.
 */
function clean(v) {
  if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/[^\w \-.]/g, '').trim().slice(0, 24);
}

/** Same idea for anything used as a code or id. */
function cleanCode(v) {
  if (typeof v !== 'string') return '';
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function guessKind(ua) {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone/i.test(ua)) return 'phone';
  return 'computer';
}

// Drop sockets that stopped answering, so the radar never shows a ghost.
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    const peer = [...rooms.values()].flatMap((r) => [...r.peers.values()]).find((p) => p.ws === ws);
    if (peer) {
      // Nobody legitimately holds one socket open for six hours.
      if (now - peer.openedAt > MAX_SESSION_MS) {
        log('info', 'session-expired', {});
        ws.close(4010, 'session too long');
        continue;
      }
      if (!peer.alive) {
        ws.terminate();
        continue;
      }
      peer.alive = false;
    }
    if (ws.readyState === ws.OPEN) ws.ping();
  }
}, HEARTBEAT_MS).unref();

/* ------------------------------------------------------------------ start */

server.listen(PORT, '0.0.0.0', () => {
  if (LOG_JSON) {
    log('info', 'started', { port: PORT, node: process.version });
  } else {
    console.log(`\n  K-Drop  ·  a free file transfer tool by Kalman`);
    console.log(`  listening on  http://localhost:${PORT}`);
    console.log(`  open that on this machine, then pair a phone with the code and PIN.\n`);
  }
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));

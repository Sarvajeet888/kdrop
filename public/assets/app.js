/**
 * K-Drop app — wires the convergence trace, the pairing panel and the
 * transfer engine to the page. A Kalman project.
 */

import { Signal, Link, Sender, Receiver, deriveAuthSecret, deviceLabel, fmtBytes, fmtRate, fmtEta } from './core.js';
import { Trace } from './trace.js';
import * as i18n from './i18n.js';
import { t } from './i18n.js';
import * as recent from './history.js';
import { Scanner, scanSupported, codeFromScan } from './scan.js';
import { qrSvgDataUrl } from './qr.js';
import { safeFilename, wasRewritten, looksExecutable } from './filename.js';
import * as trust from './trust.js';
import { paint } from './art.js';
import { readStats, describeRoute, describeRtt, asText } from './diagnostics.js';
import { previewAll, thumbnail, kindOf } from './preview.js';
import { explainSpeed, SpeedMeter } from './speed.js';

const $ = (id) => document.getElementById(id);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** What kind of thing is this page open on? Drives the copy and the layout. */
const DEVICE = (() => {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'tablet';
  if (/Tablet|PlayBook|Silk/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'phone';
  return 'computer';
})();

/* ------------------------------------------------------------------ state */

const state = {
  code: null,
  pin: null,
  me: null,
  name: localStorage.getItem('kdrop.name') || deviceLabel(),
  links: new Map(),      // peerId -> Link
  peers: new Map(),      // peerId -> { id, name, kind, mode }
  relayLink: null,
  activeSend: null,
  sharedPending: null,
  hiddenAt: null,
  verified: new Set(),
  installOffered: false,
  authSecret: null,
  role: null,        // 'send' | 'receive' — chosen by the person, drives the whole page
  activeBatch: null,
  queue: [],
  rejoining: false,
  resumeLoop: false,
  lastFocus: null,
  activeRecv: null,
  pending: null,
  config: { iceServers: [] },
};

const trace = new Trace($('trace'));
const signal = new Signal();

/* ------------------------------------------------------------------ toast */

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

function setStatus(el, text, s) {
  el.textContent = text;
  el.dataset.state = s;
}

/* ------------------------------------------------------------------ boot */

(async function boot() {
  i18n.init();
  buildLangPicker();
  applyDeviceCopy();
  renderHistory();
  renderTrusted();

  try {
    state.config = await (await fetch('/api/config')).json();
  } catch {
    state.config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }

  trace.start();
  trace.waiting();

  wireUi();
  wireSignal();
  signal.connect();

  // Re-render anything built in JavaScript when the language changes.
  document.addEventListener('langchange', () => {
    applyDeviceCopy();
    renderPeers();
    renderHistory();
    updateRoute();
  });

  registerServiceWorker();
  paint();
  wireReveal();
  wireDiagnostics();
  wireInstall();
  checkEnvironment();
  wireScanner();

  // Anything that reads the query string runs first: arming the back stack
  // rewrites the address, and would strip ?shared= or ?action= before these
  // ever saw it.
  collectSharedFiles();
  applyLaunchAction();
  wireLifecycle();

  // A handle for diagnostics and automated tests. Read-only in practice —
  // it exposes nothing a user could not already reach from the console.
  window.__kdrop = { state, signal, trace, version: 1 };
})();

/* ------------------------------------------------------------- language */

function buildLangPicker() {
  const sel = $('langSelect');
  if (!sel) return;
  sel.innerHTML = i18n.available()
    .map((l) => `<option value="${l.code}"${l.code === i18n.lang() ? ' selected' : ''}>${esc(l.name)}</option>`)
    .join('');
  sel.onchange = () => i18n.setLang(sel.value);
}

/* --------------------------------------------------------- device copy */

/**
 * A phone and a laptop are doing different jobs in the same session. The
 * laptop usually shows the code; the phone usually scans it. Saying so beats
 * making both read the same generic instruction.
 */
function applyDeviceCopy() {
  document.body.dataset.device = DEVICE;
  const title = $('pairTitle');
  if (title) {
    title.textContent = DEVICE === 'computer' ? t('pair.title') : t('pair.titlePhone');
  }
}

/* -------------------------------------------------------------- history */

function renderHistory() {
  const card = $('cardHistory');
  const list = $('historyList');
  if (!card || !list) return;

  const groups = recent.grouped();
  const total = groups.today.length + groups.yesterday.length + groups.earlier.length;

  if (!total) { card.hidden = true; return; }
  card.hidden = false;
  card.querySelector('.fineprint').hidden = true;

  const label = { today: t('send.today'), yesterday: t('send.yesterday'), earlier: t('send.earlier') };
  let html = '';
  for (const k of ['today', 'yesterday', 'earlier']) {
    if (!groups[k].length) continue;
    html += `<p class="hist-day">${esc(label[k])}</p>`;
    for (const e of groups[k]) {
      const arrow = e.dir === 'out' ? '→' : '←';
      const who = e.peer ? `${e.dir === 'out' ? t('send.devices') : ''} ${esc(e.peer)}`.trim() : '';
      html += `
        <div class="hist-row${e.ok ? '' : ' bad'}">
          <span class="g" data-kind="${recent.glyph(e.name)}"></span>
          <span class="nm">${esc(e.name)}${e.count > 1 ? ` <span class="mut">+${e.count - 1}</span>` : ''}</span>
          <span class="mut">${fmtBytes(e.bytes)}</span>
          <span class="mut">${arrow} ${esc(who)}</span>
        </div>`;
    }
  }
  list.innerHTML = html;
}

function noteHistory(dir, name, count, bytes, peer, route, ok) {
  recent.add({ dir, name, count, bytes, peer, route, ok });
  renderHistory();
}

/* -------------------------------------------------------- service worker */

/**
 * Files handed to us by the Android share sheet.
 *
 * The service worker caught the POST and stashed them; we pick them up here.
 * They queue until a device is connected, so someone can share from their
 * gallery first and pair afterwards, which is the natural order on a phone.
 */
async function collectSharedFiles() {
  const params = new URLSearchParams(location.search);
  if (params.get('shared') !== '1') {
    if (params.get('shared') === 'error') toast(t('toast.shareFailed'), 'warn');
    return;
  }

  // Clean the URL immediately so a reload does not look like a second share.
  history.replaceState({ kdrop: 'root' }, '', location.pathname + location.hash);

  try {
    const cache = await caches.open('kdrop-share');
    const metaRes = await cache.match('/__share_meta');
    if (!metaRes) return;
    const meta = await metaRes.json();

    const files = [];
    for (let i = 0; i < meta.files.length; i++) {
      const res = await cache.match(`/__share_file_${i}`);
      if (!res) continue;
      const blob = await res.blob();
      files.push(new File([blob], meta.files[i].name, { type: meta.files[i].type || blob.type }));
      await cache.delete(`/__share_file_${i}`);
    }
    await cache.delete('/__share_meta');

    if (meta.text && !files.length) {
      switchTab('Text');
      $('noteBox').value = meta.text;
      toast(t('toast.shareReady'));
      return;
    }
    if (!files.length) return;

    state.sharedPending = files;
    toast(`${files.length} ${files.length === 1 ? t('ask.aFile') : t('ask.files')} ${t('toast.shareQueued')}`);
    flushShared();
  } catch (e) {
    console.warn('share', e);
  }
}

/** Send anything the share sheet gave us, once a device is actually there. */
function flushShared() {
  if (!state.sharedPending || !firstLiveLink()) return;
  const files = state.sharedPending;
  state.sharedPending = null;
  sendFiles(files);
}

/** Home-screen shortcuts land here: "Send" or "Receive". */
function applyLaunchAction() {
  const action = new URLSearchParams(location.search).get('action');
  if (action === 'send' || action === 'receive') setRole(action, { jump: true });
}

/* ------------------------------------------------------------------ trust */

/**
 * Work out whether the device we just connected to is one we already trust.
 *
 * Both sides announce a local device id, then each challenges the other to
 * prove it holds the shared secret from a previous pairing. A device that
 * merely claims a familiar id proves nothing and gets no privileges.
 */
async function startTrustHandshake(link) {
  if (!trust.available()) return;
  link.trustChallenge = trust.newChallenge();
  link.send({ t: 'trust-hello', id: trust.selfId(), name: state.name, challenge: link.trustChallenge });
}

async function onTrustMessage(link, m) {
  if (!trust.available()) return;

  if (m.t === 'trust-hello') {
    link.theirId = m.id;
    const response = await trust.answer(m.id, m.challenge);
    link.send({
      t: 'trust-proof',
      id: trust.selfId(),
      response,                       // null when we do not know them
      challenge: link.trustChallenge || trust.newChallenge(),
    });
    return;
  }

  if (m.t === 'trust-proof') {
    link.theirId = link.theirId || m.id;
    const proven = await trust.verify(link.theirId, link.trustChallenge, m.response);
    link.trusted = proven;

    if (proven) {
      trust.touch(link.theirId, peerName(link));
      renderPeers();
      toast(`${peerName(link)} — ${t('trust.recognised')}`);
    } else {
      // Not known, or could not prove it. Offer to establish trust, but only
      // after a transfer has actually succeeded — see rememberAfterTransfer.
      link.canTrust = Boolean(link.theirId);
    }
    return;
  }

  // One side proposes the secret; the other stores the same value.
  if (m.t === 'trust-secret' && link.theirId && m.secret) {
    trust.remember(link.theirId, peerName(link), m.secret);
    link.trusted = true;
    renderPeers();
    renderTrusted();
  }
}

/**
 * Offer to remember a device, but only once something has actually worked.
 *
 * Asking before a transfer would be asking someone to trust a device that has
 * not yet done anything, which is a decision they have no basis to make.
 */
function offerTrust(link) {
  if (!trust.available() || !link || link.trusted || !link.canTrust) return;
  if (trust.isKnown(link.theirId)) return;

  const name = peerName(link) || t('trust.thisDevice');
  const bar = document.createElement('div');
  bar.className = 'trust-offer';
  bar.innerHTML = `<span>${esc(name)} — ${esc(t('trust.offer'))}</span>`;

  const yes = document.createElement('button');
  yes.className = 'btn btn-quiet';
  yes.type = 'button';
  yes.textContent = t('trust.remember');
  yes.onclick = () => {
    const secret = trust.proposeSecret();
    trust.remember(link.theirId, name, secret);
    link.send({ t: 'trust-secret', secret });
    link.trusted = true;
    bar.remove();
    renderPeers();
    renderTrusted();
    toast(t('trust.saved'));
  };

  const no = document.createElement('button');
  no.className = 'linkish';
  no.type = 'button';
  no.textContent = t('trust.notNow');
  no.onclick = () => { link.canTrust = false; bar.remove(); };

  bar.append(yes, no);
  $('notes').prepend(bar);
}

/** The list of remembered devices, and the controls to forget them. */
function renderTrusted() {
  const card = $('cardTrusted');
  const list = $('trustedList');
  if (!card || !list) return;

  const devices = trust.all();
  if (!devices.length) { card.hidden = true; return; }
  card.hidden = false;

  list.innerHTML = devices.map((d) => `
    <div class="trust-row" data-id="${esc(d.id)}">
      <span class="nm">${esc(d.name)}</span>
      <label class="auto">
        <input type="checkbox" ${d.autoAccept ? 'checked' : ''} data-auto="${esc(d.id)}">
        <span>${esc(t('trust.autoAccept'))}</span>
      </label>
      <button class="linkish" type="button" data-forget="${esc(d.id)}">${esc(t('trust.forget'))}</button>
    </div>`).join('');

  for (const el of list.querySelectorAll('[data-forget]')) {
    el.onclick = () => { trust.forget(el.dataset.forget); renderTrusted(); toast(t('trust.forgotten')); };
  }
  for (const el of list.querySelectorAll('[data-auto]')) {
    el.onchange = () => trust.setAutoAccept(el.dataset.auto, el.checked);
  }
}

/* ---------------------------------------------------------------- outcome */

/**
 * Report that a transfer finished, as a single word.
 *
 * The server is not in the path of a direct transfer, so without this it
 * cannot tell whether K-Drop works — only that people paired. The report
 * carries nothing but which counter to increment: no size, no duration, no
 * filename, no session reference, nothing that separates one person's
 * transfer from anyone else's.
 *
 * That distinction is why the privacy policy can still say there is no
 * analytics. These are gauges on the service, not observations of people.
 */
function reportOutcome(result) {
  if (!signal.ready) return;
  signal.send({ t: 'outcome', r: result });
}

/* ---------------------------------------------------------------- scanner */

let scanner = null;

function wireScanner() {
  // No detector, no button. Better than a button that fails when pressed.
  if (!scanSupported()) return;
  $('scanRow').hidden = false;

  $('scanStart').onclick = async () => {
    $('scanBox').hidden = false;
    $('scanRow').hidden = true;
    scanner = new Scanner($('scanVideo'));
    try {
      await scanner.start((text) => {
        closeScanner();
        const code = codeFromScan(text);
        if (!code) return toast(t('scan.notKdrop'), 'warn');
        $('joinCode').value = code;
        joinWith(code);
      });
    } catch (e) {
      closeScanner();
      toast(e.message === 'denied' ? t('scan.denied') : t('scan.noCamera'), 'warn');
    }
  };

  $('scanStop').onclick = closeScanner;
}

function closeScanner() {
  if (scanner) { scanner.stop(); scanner = null; }
  $('scanBox').hidden = true;
  if (scanSupported()) $('scanRow').hidden = false;
}

/* ------------------------------------------------------- device lifecycle */

/**
 * Keep the screen awake while a transfer is running.
 *
 * A Trusted Web Activity cannot run a background service, so if the phone
 * sleeps the page is suspended and the transfer stalls. Holding a wake lock
 * for the duration is the honest fix available to a web app: it does not make
 * transfers work in the background, it stops them dying in the foreground.
 *
 * The lock is released the moment nothing is moving, so it never sits there
 * draining a battery.
 */
let wakeLock = null;

async function holdScreenAwake() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Denied, or the tab is already hidden. Not worth telling anyone about.
  }
}

function releaseScreen() {
  if (!wakeLock) return;
  try { wakeLock.release(); } catch {}
  wakeLock = null;
}

function transferRunning() {
  return Boolean(state.activeSend || state.activeRecv);
}

/** Called whenever a transfer starts or finishes. */
function syncScreenLock() {
  if (transferRunning()) holdScreenAwake();
  else releaseScreen();
}

function wireLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // A wake lock is dropped automatically when the tab is hidden, so it has
      // to be taken again on return.
      if (transferRunning()) holdScreenAwake();
      updateRoute();
      resumeAfterReturning();
      return;
    }

    state.hiddenAt = Date.now();

    // Leaving mid-transfer is the most common way a phone transfer fails.
    // Say so while the person can still act on it.
    if (scanner) closeScanner();   // never leave a camera running unattended
    if (transferRunning()) toast(t('toast.keepOpen'), 'warn');
  });

  // Android back: close whatever is open before leaving the app.
  armBack();
  window.addEventListener('popstate', () => {
    if (scanner) {
      closeScanner();
      armBack();
      return;
    }
    if (!$('ask').hidden) {
      decline();
      armBack();
      return;
    }
    if (state.role) {
      clearRole();
      armBack();
      return;
    }
    // Nothing left to close — let the back press exit as normal.
  });
}

/**
 * Put a fresh entry on the history stack, keeping the pairing code in the
 * address.
 *
 * pushState without a URL keeps whatever is there now — but the first entry
 * was created before a code existed, so going back to it would strip the hash
 * and silently break the shareable link. Passing the hash explicitly means
 * every entry carries it.
 */
function armBack() {
  const url = location.pathname + (state.code ? `#${state.code}${state.pin || ''}` : location.hash);
  history.pushState({ kdrop: 'root' }, '', url);
}

/**
 * Pick a stalled transfer back up when the person returns.
 *
 * A phone suspends a background tab within seconds, which freezes the send
 * loop and usually drops the connection. Coming back does not restart it on
 * its own, so this asks the receiver what it actually has and continues from
 * there — the same machinery used after a Wi-Fi drop.
 *
 * This covers leaving the app and returning. It does not, and cannot, cover
 * closing the tab: the page and everything in it stop existing.
 */
function resumeAfterReturning() {
  const away = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
  state.hiddenAt = null;
  if (!away || away < 1500) return;          // a glance, not a departure

  const sender = state.activeSend;
  if (!sender || !sender.inflight || sender.settled) return;

  const live = firstLiveLink();
  if (live) {
    toast(t('toast.resumingReturn'));
    tryResume(live);
    return;
  }

  // No link yet — the socket is probably still reconnecting. tryResume runs
  // again from the link's own 'up' handler, so nothing is lost by waiting.
  markRow(sender.batchId, 'waiting', t('send.interrupted'));
}

/**
 * A completed transfer often finishes while the person is looking at something
 * else. A notification is the only way they find out without checking.
 */
async function notifyDone(title, body) {
  if (!('Notification' in window)) return;
  if (document.visibilityState === 'visible') return;   // they can already see it
  if (Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) reg.showNotification(title, { body, icon: '/assets/icon-192.png', tag: 'kdrop-transfer' });
  } catch {}
}

/** Asked for only when a transfer is accepted — never on page load. */
async function askToNotify() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { await Notification.requestPermission(); } catch {}
}

/* ---------------------------------------------------------------- install */

/**
 * Offer to install, but only once the app has proved useful.
 *
 * Browsers hand us the install prompt as soon as the page qualifies. Firing it
 * immediately is the pattern everyone has learned to dismiss without reading,
 * so it is held until a transfer has actually completed — at which point the
 * offer means something.
 */
let installPrompt = null;

function wireInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // stop the browser's own banner
    installPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('installBar')?.remove();
    toast(t('install.done'));
  });
}

function offerInstall() {
  if (!installPrompt) return;
  if (matchMedia('(display-mode: standalone)').matches) return;   // already installed
  if (state.installOffered) return;
  state.installOffered = true;

  const bar = document.createElement('div');
  bar.id = 'installBar';
  bar.className = 'install-bar';
  bar.innerHTML = `<span>${esc(t('install.offer'))}</span>`;

  const yes = document.createElement('button');
  yes.className = 'btn btn-quiet';
  yes.type = 'button';
  yes.textContent = t('install.add');
  yes.onclick = async () => {
    const p = installPrompt;
    installPrompt = null;
    bar.remove();
    try { await p.prompt(); } catch {}
  };

  const no = document.createElement('button');
  no.className = 'linkish';
  no.type = 'button';
  no.textContent = t('install.notNow');
  no.onclick = () => bar.remove();

  bar.append(yes, no);
  $('notes').prepend(bar);
}

/* ---------------------------------------------------------------- summary */

/**
 * What actually happened, once it has happened.
 *
 * A progress bar that reaches the end and vanishes leaves people unsure
 * whether it worked. This states the outcome in the terms they care about:
 * how much, how long, how fast, and by which route.
 */
function showSummary(rowId, s) {
  const row = $(`row-${rowId}`);
  if (!row || row.querySelector('.summary')) return;

  const rate = s.seconds > 0 ? s.bytes / s.seconds : 0;
  const box = document.createElement('div');
  box.className = 'summary';
  box.innerHTML = [
    [t('summary.files'), String(s.files)],
    [t('summary.size'), fmtBytes(s.bytes)],
    [t('summary.time'), fmtEta(s.seconds)],
    [t('summary.speed'), fmtRate(rate)],
    [t('summary.route'), s.route === 'direct' ? t('pair.direct') : t('pair.relayed')],
  ].map(([k, v]) => `<span><em>${esc(k)}</em>${esc(v)}</span>`).join('');
  row.append(box);
}

/* --------------------------------------------------------------- previews */

/**
 * Show what is about to be sent.
 *
 * Thumbnails are decoded from the local file and never transmitted. They exist
 * to catch the mistake people actually make — sending the wrong photo — which
 * a list of filenames does not.
 */
async function showPreviews(batch) {
  const row = $(`row-${batch.id}`);
  if (!row) return;

  const strip = document.createElement('div');
  strip.className = 'preview-strip';
  strip.innerHTML = `<span class="empty">${esc(t('send.preparing'))}</span>`;
  row.append(strip);

  const items = await previewAll(batch.files);
  if (!document.body.contains(strip)) return;   // transfer finished first

  const shown = items.slice(0, 8);
  const more = items.length - shown.length;

  strip.innerHTML = shown.map((i) => (
    i.thumb
      ? `<img class="thumb" src="${i.thumb}" alt="${esc(i.name)}" title="${esc(i.name)}">`
      : `<span class="thumb glyph" data-kind="${esc(i.kind)}" title="${esc(i.name)}"></span>`
  )).join('') + (more > 0 ? `<span class="thumb more">+${more}</span>` : '');
}

/* ------------------------------------------------------------ verification */

/**
 * Show the code a person compares across the two screens.
 *
 * Every other check in the pairing is done by software. This is the one a
 * human performs, and it is the only thing that can catch interference the
 * software cannot reason about. It is offered, never forced — most transfers
 * do not warrant it, and a prompt nobody reads protects nobody.
 *
 * Once confirmed for a session it stays confirmed; asking repeatedly for the
 * same pair of devices trains people to click through it.
 */
function showFingerprint(link, fp) {
  const box = $('verifyBox');
  if (!box || !fp) return;

  // A device already verified in this session does not need asking again.
  if (state.verified.has(fp)) { box.hidden = true; return; }

  $('verifyCode').textContent = fp;
  box.hidden = false;
  $('verifyNote').hidden = true;

  $('verifyYes').onclick = () => {
    state.verified.add(fp);
    box.hidden = true;
    toast(t('verify.confirmed'));
    renderPeers();
  };

  $('verifyWhy').onclick = () => {
    const note = $('verifyNote');
    note.hidden = !note.hidden;
  };
}

/* ------------------------------------------------------------- diagnostics */

let diagTimer = null;

/**
 * A panel of real numbers from the live connection.
 *
 * Only refreshes while it is open. Polling getStats continuously would cost
 * battery to display something nobody is looking at.
 */
function wireDiagnostics() {
  const box = $('diagBox');
  if (!box) return;

  box.addEventListener('toggle', () => {
    clearInterval(diagTimer);
    if (!box.open) return;
    refreshDiagnostics();
    diagTimer = setInterval(refreshDiagnostics, 2000);
  });

  $('diagCopy').onclick = async () => {
    const link = firstLiveLink();
    const stats = await readStats(link);
    const text = asText(state, stats, {
      mode: link ? link.mode : null,
      chunkSize: link ? link.chunkSize : null,
      secure: Boolean(link && link.key),
    });
    try {
      await navigator.clipboard.writeText(text);
      toast(t('diag.copied'));
    } catch {
      // Clipboard can be refused; showing the text is still useful.
      $('diagBody').innerHTML = `<pre class="diag-text">${esc(text)}</pre>`;
    }
  };
}

async function refreshDiagnostics() {
  const body = $('diagBody');
  if (!body) return;

  const link = firstLiveLink();
  if (!link) {
    body.innerHTML = `<p class="empty">${esc(t('diag.noConnection'))}</p>`;
    return;
  }

  const stats = await readStats(link);
  const route = describeRoute(stats);
  const rtt = describeRtt(stats && stats.rttMs);

  const rows = [
    [t('diag.route'), link.mode === 'direct' ? t('pair.direct') : t('pair.relayed'),
      link.mode === 'direct' ? 'best' : 'ok'],
    [t('diag.rtt'), stats && stats.rttMs != null ? `${stats.rttMs} ms` : '—', rtt.quality],
    [t('diag.path'), route.label, route.quality],
    [t('diag.encryption'), link.key ? t('diag.sessionKey') : t('diag.browserOnly'), 'best'],
    [t('diag.frame'), `${Math.round(link.chunkSize / 1024)} KB`, null],
    [t('diag.toDisk'), 'showDirectoryPicker' in window ? t('diag.yes') : t('diag.no'),
      'showDirectoryPicker' in window ? 'best' : 'ok'],
  ];

  const advice = rtt.advice || route.advice;

  body.innerHTML = rows.map(([k, v, q]) => `
      <div class="diag-row">
        <span class="k">${esc(k)}</span>
        <span class="v${q ? ' q-' + q : ''}">${esc(v)}</span>
      </div>`).join('')
    + (advice ? `<p class="diag-advice">${esc(t('diag.' + advice))}</p>` : '');
}

/* ------------------------------------------------------------------ motion */

/**
 * Reveal sections as they come into view.
 *
 * The class that hides them is only ever added by this function, so a browser
 * without IntersectionObserver — or with JavaScript disabled — simply shows
 * everything. Content that depends on script to become visible is a bug, not
 * an effect.
 */
function wireReveal() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  // Position-based only. Nothing here reacts to the pointer — no parallax,
  // no cursor trails, no tilt. Motion should tell you where you are on the
  // page, not follow your hand around it.
  const groups = [
    ['.how > div', 'reveal'],
    ['.steps > div', 'reveal'],
    ['.ill', 'reveal-grow'],
    ['.platforms li', 'reveal-grow'],
    ['.routes li', 'reveal'],
    ['.qa details', 'reveal-left'],
    ['.plain h2, .dark h2, .doc h2, .route-page h2', 'seen-only'],
    ['.doc table, .route-page table', 'reveal'],
    ['.callout', 'reveal-right'],
    ['.spec > div', 'reveal-grow'],
    ['.status-row', 'reveal'],
  ];

  const targets = [];
  for (const [selector, cls] of groups) {
    for (const el of document.querySelectorAll(selector)) {
      if (cls !== 'seen-only') el.classList.add(cls);
      targets.push(el);
    }
  }
  if (!targets.length) return;

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('seen');
      io.unobserve(e.target);      // reveal once; re-animating on scroll is noise
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });

  for (const el of targets) io.observe(el);
}

/* --------------------------------------------------------- environment */

/**
 * Tell the person up front what this browser and this connection can and
 * cannot do.
 *
 * The important one is the secure-context check. Over plain http — which is
 * exactly what you get testing on a local network address — crypto.subtle is
 * unavailable, so the PIN cannot derive a key and the encrypted fallback route
 * is not available. That failure used to be silent, which is the worst kind:
 * the page still says it encrypts, and it no longer does.
 */
function checkEnvironment() {
  const box = $('envNotice');
  if (!box) return;

  const problems = [];

  if (typeof RTCPeerConnection === 'undefined') {
    problems.push({ level: 'bad', text: t('env.noWebrtc') });
  }

  if (!window.isSecureContext) {
    problems.push({ level: 'warn', text: t('env.insecure') });
  } else if (!(window.crypto && crypto.subtle)) {
    problems.push({ level: 'warn', text: t('env.noCrypto') });
  }

  if (!('showDirectoryPicker' in window) && window.isSecureContext) {
    problems.push({ level: 'info', text: t('env.noStreaming') });
  }

  if (!problems.length) { box.hidden = true; return; }

  box.hidden = false;
  box.innerHTML = '';
  for (const p of problems) {
    const el = document.createElement('p');
    el.className = `env-item ${p.level}`;
    el.textContent = p.text;
    box.append(el);
  }

  // A missing WebRTC engine is not a warning, it is the end of the road.
  if (problems.some((p) => p.level === 'bad')) {
    $('cardPair').classList.add('off');
    $('cardSend').classList.add('off');
  }
}

/* ------------------------------------------------------------------ role */

/**
 * Which side of the transfer is this person on?
 *
 * Both devices can do both things, and nothing here restricts that. But
 * someone who came to receive a photo does not need a drop zone in front of
 * them, and someone who came to send does not need the join box. Saying which
 * one you are turns one crowded screen into two clear ones.
 */
function setRole(role, { jump = false } = {}) {
  state.role = role;
  document.body.dataset.role = role;

  $('roleLine').hidden = false;
  $('roleText').textContent = role === 'send' ? t('role.sending') : t('role.receiving');
  $('roleSwap').textContent = role === 'send' ? t('role.swapToReceive') : t('role.swapToSend');

  $('pairTitle').textContent = role === 'send'
    ? t('role.sendPairTitle')
    : t('role.receivePairTitle');

  // The divider label flips with the role: a sender is offering a code, a
  // receiver is being offered one.
  const divider = document.querySelector('#cardPair .divider');
  if (divider) divider.textContent = role === 'receive' ? t('role.orShowYours') : t('pair.orEnter');

  applyRoleToStepTwo();

  if (jump) {
    document.getElementById('app')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (role === 'receive') setTimeout(() => $('joinCode').focus({ preventScroll: true }), 400);
  }
}

/** Back out of a chosen role, returning to the neutral first screen. */
function clearRole() {
  state.role = null;
  delete document.body.dataset.role;
  $('roleLine').hidden = true;
  $('pairTitle').textContent = DEVICE === 'computer' ? t('pair.title') : t('pair.titlePhone');
  const divider = document.querySelector('#cardPair .divider');
  if (divider) divider.textContent = t('pair.orEnter');
  $('awaitBox').hidden = true;
  $('tabs')?.removeAttribute('hidden');
  $('paneFiles').hidden = $('tabText').getAttribute('aria-selected') === 'true';
}

/** Step 2 shows the drop zone to a sender and a plain waiting note to a receiver. */
function applyRoleToStepTwo() {
  const receiving = state.role === 'receive';
  const connected = Boolean(firstLiveLink());

  $('awaitBox').hidden = !(receiving && connected);
  $('paneFiles').hidden = receiving || $('tabText').getAttribute('aria-selected') === 'true';
  $('tabs')?.toggleAttribute('hidden', receiving);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* Offline shell is a bonus, never a requirement. */
  });
}

/* --------------------------------------------------------------- signalling */

function wireSignal() {
  signal.on('open', () => {
    setStatus($('netState'), t('nav.online'), 'on');

    // A reconnect after a dropped Wi-Fi signal must return to the same room,
    // not start a fresh one — otherwise an interrupted transfer can never
    // resume, and the other device is left staring at a dead code.
    if (state.code) {
      state.rejoining = true;
      signal.send({ t: 'join', code: state.code, name: state.name });
      return;
    }

    const hash = location.hash.replace(/^#/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // A link is only a valid invite if it carries the PIN as well.
    if (hash.length >= 10) joinWith(hash);
    else createRoom();
  });

  signal.on('close', () => {
    setStatus($('netState'), t('nav.offline'), 'down');
    // Every link runs over this socket — directly for relayed transfers, and
    // for the signalling that keeps a direct one alive. Closing them now makes
    // in-flight sends fail immediately instead of disappearing into a
    // reconnected socket the server no longer associates with our room.
    for (const l of state.links.values()) l.close();
    state.links.clear();
    state.peers.clear();
    renderPeers();
  });

  signal.on('room', async (m) => {
    state.me = m.id;
    state.code = m.code;
    state.pin = state.pin || randomPin();
    state.authSecret = await deriveAuthSecret(state.code, state.pin);
    // A peer can connect before the secret finishes deriving; hand it to any
    // link that has been waiting.
    for (const l of state.links.values()) { l.flushPendingKx(); l.startKeyExchange(); }
    showCode();
  });

  signal.on('joined', async (m) => {
    state.me = m.id;
    state.code = m.code;
    state.authSecret = await deriveAuthSecret(state.code, state.pin);
    // A peer can connect before the secret finishes deriving; hand it to any
    // link that has been waiting.
    for (const l of state.links.values()) { l.flushPendingKx(); l.startKeyExchange(); }
    showCode();
    // The joiner opens the connection to everyone already in the room.
    for (const p of m.peers) {
      addPeer(p);
      makeLink(p.id, true);
    }
    if (m.peers.length === 0) toast(t('pair.waiting'));
  });

  signal.on('peer-joined', (m) => {
    addPeer(m.peer);
    makeLink(m.peer.id, false);
    trace.connected();
    toast(`${m.peer.name} ${t('toast.joined')}`);
  });

  signal.on('peer-left', (m) => {
    const p = state.peers.get(m.id);
    state.peers.delete(m.id);
    const link = state.links.get(m.id);
    if (link) { link.close(); state.links.delete(m.id); }
    renderPeers();
    if (p) toast(`${p.name} ${t('toast.left')}`);
  });

  signal.on('peer-renamed', (m) => {
    const p = state.peers.get(m.id);
    if (p) { p.name = m.name; renderPeers(); }
  });

  signal.on('signal', (m) => {
    const link = state.links.get(m.from) || makeLink(m.from, false);
    link.onSignal(m.data);
  });

  signal.on('ctl', (m) => {
    const link = state.links.get(m.from);
    if (link) link.control(m.data);
  });

  signal.on('relay-ready', (m) => {
    state.relayLink = state.links.get(m.to) || null;
  });

  signal.on('binary', (buf) => {
    const link = state.activeRecv?.link || state.relayLink || [...state.links.values()].find((l) => l.mode === 'relayed');
    if (link) link.relayBytes(buf);
  });

  signal.on('error', (m) => {
    if (!m) return;
    if (m.reason === 'no-room') {
      // If we were trying to get back into our own room, it expired while we
      // were away. Say so rather than silently swapping the code underneath.
      if (state.rejoining) {
        state.rejoining = false;
        state.code = null;
        failActiveTransfers(t('toast.expired'));
      }
      toast(t('toast.badCode'), 'warn');
      createRoom();
    }
    if (m.reason === 'blocked') {
      toast(t('toast.blocked'), 'bad');
    }
    if (m.reason === 'full') toast(t('toast.full'), 'warn');
    if (m.reason === 'rate-limited') {
      toast(t('toast.rateLimited'), 'warn');
      $('codeOut').textContent = 'Try again shortly';
      $('codeOut').dataset.empty = '1';
    }
    if (m.reason === 'too-many') {
      toast(t('toast.tooMany'), 'warn');
    }
  });

  // The relay has a per-session ceiling, because it is the only part of this
  // that costs us money. Say so plainly rather than just stalling.
  signal.on('relay-limit', (m) => {
    if (state.activeSend) state.activeSend.cancel();
    toast(`This session hit the ${fmtBytes(m.limit)} limit on the slower route. Start a new session to keep going.`, 'bad');
  });

  signal.on('expired', () => {
    toast(t('toast.expired'), 'warn');
    createRoom();
  });
}

function createRoom() {
  state.pin = randomPin();
  state.peers.clear();
  for (const l of state.links.values()) l.close();
  state.links.clear();
  renderPeers();
  signal.send({ t: 'create', name: state.name });
}

/**
 * Join a session. The PIN is required, not optional.
 *
 * The PIN is the only input to the relay encryption key, and the server never
 * receives it. Joining with the code alone would still connect — and would
 * silently lose end-to-end encryption the moment a network forced the relayed
 * route. A quiet downgrade is worse than a refusal, so we refuse.
 */
function joinWith(raw) {
  if (raw.length < 10) {
    toast(t('toast.needPin'), 'bad');
    return false;
  }
  state.pin = raw.slice(6, 10);
  signal.send({ t: 'join', code: raw.slice(0, 6), name: state.name });
  return true;
}

function randomPin() {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
}

/* ------------------------------------------------------------------- links */

function makeLink(peerId, initiator) {
  if (state.links.has(peerId)) return state.links.get(peerId);

  const link = new Link(signal, peerId, {
    polite: state.me < peerId,
    iceServers: state.config.iceServers,
    getAuthSecret: () => state.authSecret,
  });

  link.on('mode', (mode) => {
    const p = state.peers.get(peerId);
    if (p) p.mode = mode;
    if (mode === 'relayed') state.relayLink = link;
    renderPeers();
    updateRoute();
  });

  link.on('rtt', () => { renderPeers(); updateRoute(); });
  link.on('note', (why) => {
    if (why === 'stale') return toast(t('toast.stale'), 'bad');
    toast(`Using the relay — ${why}.`, 'warn');
  });
  link.on('up', () => {
    trace.connected();
    updateRoute();
    // A reconnect creates a fresh Link object. Anything mid-transfer is still
    // holding the dead one, so hand it the new connection before resuming —
    // otherwise its replies go nowhere and both sides quietly disagree.
    if (state.activeRecv && (state.activeRecv.link.dead || state.activeRecv.link.peerId === link.peerId)) state.activeRecv.link = link;
    flushShared();
    // Let any closed link finish unwinding before asking where we got to.
    Promise.resolve().then(() => tryResume(link));
  });
  link.on('ctl', ({ msg, hold }) => hold(onControl(link, msg)));
  link.on('up', () => startTrustHandshake(link));
  link.on('fingerprint', (fp) => showFingerprint(link, fp));
  link.on('bytes', ({ buf, hold }) => {
    if (state.activeRecv?.link === link) hold(state.activeRecv.onBytes(buf));
  });

  state.links.set(peerId, link);
  link.start(initiator).catch((e) => {
    console.warn('link start', e);
    link.fallback('the direct connection could not be set up');
  });
  return link;
}

function peerName(link) {
  return (link && state.peers.get(link.peerId)?.name) || '';
}

function firstLiveLink() {
  return [...state.links.values()].find((l) => l.mode === 'direct' || l.mode === 'relayed') || null;
}

function updateRoute() {
  const link = firstLiveLink();
  const card = $('cardSend');

  if (!link) {
    setStatus($('routeNote'), t('send.firstStep'), 'off');
    setStatus($('pairNote'), t('pair.waiting'), 'off');
    card.classList.add('off');
    $('dropSub').textContent = t('send.dropSubLocked');
    $('sendNote').disabled = true;
    $('traceState').textContent = t('pair.notConnected');
    trace.waiting();
    return;
  }

  const rtt = link.rtt != null ? ` · ${link.rtt}ms` : '';
  const direct = link.mode === 'direct';
  setStatus($('routeNote'), t('send.ready'), 'on');
  setStatus($('pairNote'), t('pair.connected'), 'on');
  card.classList.remove('off');
  $('dropSub').textContent = direct ? t('send.dropSubDirect') : t('send.dropSubRelay');
  $('sendNote').disabled = false;
  if (state.role) applyRoleToStepTwo();
  $('traceState').textContent = (direct ? t('pair.direct') : t('pair.relayed')) + rtt;
  trace.connected();
}

/* ----------------------------------------------------- control messages in */

function onControl(link, m) {
  switch (m.t) {
    case 'batch':
      askToAccept(link, m);
      break;

    case 'file-progress': case 'file-ack': case 'batch-ack': case 'transfer-error':
      if (state.activeSend?.link === link) state.activeSend.onReceipt(m);
      break;

    case 'batch-ok':
      if (state.activeSend?.link === link && state.activeSend.bid === m.bid) {
        if (m.receipts !== 1) {
          link.send({t: 'cancel', bid: m.bid});
          state.activeSend.settle('failed', new Error('Reload K-Drop on both devices to use the updated transfer protocol.'));
          break;
        }
        toast(t('toast.accepted'));
        markRow(state.activeSend.batchId, '', t('send.sending'));
        state.activeSend.run();
      }
      break;

    case 'batch-no':
      if (state.activeSend && state.activeSend.bid === m.bid) {
        markRow(state.activeSend.batchId, 'failed', t('send.declined'));
        clearRowControls(state.activeSend.batchId);
        state.activeSend = null;
        state.activeBatch = null;
        toast(t('toast.declined'), 'warn');
        pumpQueue();
      }
      break;

    case 'note':
      showNote(link, m.text);
      break;

    case 'trust-hello': case 'trust-proof': case 'trust-secret':
      return onTrustMessage(link, m);

    case 'resume-at':
      if (state.activeSend) state.activeSend.onResumeAt(m);
      break;

    case 'fstart': case 'fend': case 'bdone': case 'cancel':
    case 'resume-ask': case 'fresume':
      // Returned so the link waits for it before releasing the next chunk.
      if (state.activeRecv?.link === link) return state.activeRecv.onControl(m);
      break;
  }
}

/* --------------------------------------------------------------- sending */

/* ------------------------------------------------------------- queue */

/**
 * Batches are queued rather than refused. One moves at a time — running two
 * over one connection just makes both slower — but you can drop a second pile
 * of files in without waiting for the first to finish.
 */
function sendFiles(fileList) {
  const files = [...fileList]; // Empty files are valid transfers too.
  if (!files.length) return;
  if (!firstLiveLink()) return toast(t('toast.noDevice'), 'warn');

  const batch = {
    id: `q${Date.now().toString(36)}`,
    files,
    total: files.reduce((n, f) => n + f.size, 0),
    label: files.length === 1 ? files[0].name : `${files.length} ${t('ask.files')}`,
  };
  state.queue.push(batch);
  addRow(batch.id, batch.label, batch.total, t('send.queued'));
  showPreviews(batch);
  pumpQueue();
}

function pumpQueue() {
  if (state.activeSend || !state.queue.length) return;
  const link = firstLiveLink();
  if (!link) return;

  const batch = state.queue.shift();
  const sender = new Sender(link, batch.files);
  sender.batchId = batch.id;
  // Lets the sender reach every live link, which matters after a reconnect
  // when more than one may briefly exist.
  sender.allLinks = () => [...state.links.values()].filter((l) => !l.dead);
  state.activeSend = sender;
  state.activeBatch = batch;

  updateRow(batch.id, 0, t('send.waitingAccept'), '');
  syncScreenLock();
  setSenderControls(batch.id, sender);

  sender.on('progress', (s) => {
    renderSpeed(batch.id, sender.link, s.confirmed, { paused: sender.paused });
    updateRow(batch.id, s.pct,
      `${fmtBytes(s.sent)} of ${fmtBytes(s.total)}`,
      `${fmtRate(s.rate)} · ${fmtEta(s.eta)} · ${s.mode === 'direct' ? t('pair.direct') : t('pair.relayed')}`);
    trace.throughput(s.rate);
  });

  sender.on('resuming', (d) => {
    toast(`${t('toast.resuming')} ${fmtBytes(d.from)}`);
    markRow(batch.id, '', t('send.resuming'));
  });

  sender.on('interrupted', () => {
    // Not a failure yet — the link may come back and resume will pick it up.
    if (sender.settled) return;
    markRow(batch.id, 'waiting', t('send.interrupted'));
    trace.throughput(0);
  });

  sender.on('paused', () => markRow(batch.id, 'waiting', t('send.paused')));
  sender.on('resumed', () => markRow(batch.id, '', t('send.sending')));

  sender.on('done', () => {
    noteHistory('out', batch.label, batch.files.length, batch.total, peerName(link), link.mode, true);
    reportOutcome('ok');
    reportOutcome(link.mode === 'direct' ? 'direct' : 'relayed');
    if (sender.resumeAttempts > 0) reportOutcome('resumed');
    markRow(batch.id, 'done', t('send.sent'));
    clearRowControls(batch.id);
    showSummary(batch.id, {
      files: batch.files.length,
      bytes: batch.total,
      seconds: (performance.now() - sender.startedAt) / 1000,
      route: link.mode,
    });
    notifyDone(t('notify.sentTitle'), batch.label);
    trace.throughput(0);
    trace.connected();
    state.activeSend = null;
    state.activeBatch = null;
    syncScreenLock();
    toast(t('toast.sent'));
    offerTrust(link);
    offerInstall();
    pumpQueue();
  });

  sender.on('failed', (e) => {
    console.error(e);
    markRow(batch.id, 'failed', e?.message || t('send.failed'));
    clearRowControls(batch.id);
    reportOutcome('failed');
    trace.throughput(0);
    state.activeSend = null;
    state.activeBatch = null;
    syncScreenLock();
    toast(t('toast.failed'), 'warn');
    pumpQueue();
  });

  sender.on('cancelled', () => {
    markRow(batch.id, 'failed', t('send.cancelled'));
    clearRowControls(batch.id);
    state.activeSend = null;
    state.activeBatch = null;
    pumpQueue();
  });

  sender.ask();
}

/**
 * Called when a link comes back after a drop.
 *
 * Attempts are strictly sequential — one loop, one attempt at a time. Two
 * resume streams running at once would interleave their chunks, so the guard
 * matters more than the speed.
 */
async function tryResume(link) {
  const sender = state.activeSend;
  if (!sender || !sender.inflight) { pumpQueue(); return; }
  if (link !== sender.link && !sender.link.dead) return;
  if (state.resumeLoop) return;          // another loop already owns this
  state.resumeLoop = true;

  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (state.activeSend !== sender || sender.cancelled || sender.settled) return;

      const live = firstLiveLink();
      if (live) {
        markRow(sender.batchId, '', t('send.resuming'));
        if (await sender.resumeAfterReconnect(live)) return;   // finished
      }

      if (state.activeSend !== sender || sender.cancelled || sender.settled) return;
      markRow(sender.batchId, 'waiting', t('send.interrupted'));
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (state.activeSend === sender) {
      markRow(sender.batchId, 'failed', t('send.failed'));
      clearRowControls(sender.batchId);
      state.activeSend = null;
      state.activeBatch = null;
      toast(t('toast.failed'), 'warn');
      pumpQueue();
    }
  } finally {
    state.resumeLoop = false;
  }
}

function failActiveTransfers(why) {
  if (state.activeSend) {
    markRow(state.activeSend.batchId, 'failed', why);
    state.activeSend = null;
    state.activeBatch = null;
  }
  for (const b of state.queue) markRow(b.id, 'failed', why);
  state.queue = [];
}

function sendNote() {
  const link = firstLiveLink();
  const text = $('noteBox').value.trim();
  if (!link || !text) return;
  link.send({ t: 'note', text: text.slice(0, 20_000) });
  $('noteBox').value = '';
  toast(t('toast.textSent'));
}

/* ------------------------------------------------------------- receiving */

function askToAccept(link, batch) {
  if (state.activeRecv || state.pending) {
    link.send({t: 'batch-no', bid: batch.bid, reason: 'busy'});
    return;
  }
  // A device that proved it holds our shared secret, and that we marked as
  // auto-accept, skips the prompt. Proof matters: a device that merely claims
  // a familiar name or id gets nothing.
  if (link.trusted && link.theirId && trust.shouldAutoAccept(link.theirId)) {
    state.pending = { link, batch };
    toast(`${peerName(link)} — ${t('trust.autoAccepted')}`);
    accept();
    return;
  }

  state.pending = { link, batch };
  const who = state.peers.get(link.peerId)?.name || 'A device';

  $('askWho').textContent = `${who} wants to send ${batch.files.length === 1 ? '1 file' : `${batch.files.length} files`} — ${fmtBytes(batch.total)} in total.`;
  // Show the sanitised name, because that is the name that will be saved, and
  // flag anything that was disguised or that runs when opened. Nothing is
  // blocked — people send installers legitimately — but the decision to accept
  // should be made with the truth in front of you.
  // The receiver has no file yet, so there is nothing to make a thumbnail
  // from — the type glyph is all that is honestly available before accepting.
  $('askFiles').innerHTML = batch.files.map((f) => {
    const clean = safeFilename(f.name);
    const flags = [];
    if (wasRewritten(f.name)) flags.push(t('ask.renamed'));
    if (looksExecutable(clean)) flags.push(t('ask.runnable'));
    return `<div class="f">
        <span class="glyph" data-kind="${esc(kindOf(clean, f.type))}"></span>
        <span>${esc(clean)}${flags.length ? `<em class="flag">${esc(flags.join(' · '))}</em>` : ''}</span>
        <span>${fmtBytes(f.size)}</span>
      </div>`;
  }).join('');
  $('ask').hidden = false;
  // Keep focus inside the dialog while it is open, and give it back to
  // whatever was focused before when it closes. A keyboard or screen-reader
  // user should not be able to tab out into a page they cannot act on.
  state.lastFocus = document.activeElement;
  $('askYes').focus();
  document.addEventListener('keydown', trapAskFocus, true);
}

async function accept() {
  const { link, batch } = state.pending || {};
  closeAsk();
  if (!link) return;

  const recv = new Receiver(link, batch);
  state.activeRecv = recv;

  // Large transfers are much faster when written straight to disk, and the
  // picker can only open from inside this click. Say why, so the prompt does
  // not look like an arbitrary permission request.
  if ((batch.total || 0) > 32 * 1024 * 1024 && 'showDirectoryPicker' in window) {
    toast(t('toast.pickFolder'));
  }

  // Runs inside the accept click, which is what lets the save picker open.
  try {
    await recv.prepare();
  } catch (error) {
    state.activeRecv = null;
    state.pending = null;
    link.send({ t: 'batch-no', bid: batch.bid, reason: 'storage' });
    toast(error?.message || 'This browser cannot safely receive a transfer this large.', 'warn');
    return;
  }

  addRow(batch.bid, batch.files.length === 1 ? batch.files[0].name : `${batch.files.length} files`, batch.total, 'Receiving');

  recv.on('progress', (s) => {
    renderSpeed(batch.bid, recv.link, s.received, s);
    updateRow(batch.bid, s.pct, `${fmtBytes(s.received)} of ${fmtBytes(s.total)}`, `${fmtRate(s.rate)} · ${fmtEta(s.eta)} left · ${s.mode}`);
    trace.throughput(s.rate);
  });

  recv.on('done', (results) => {
    trace.throughput(0);
    trace.connected();
    const bad = results.filter((r) => !r.ok);
    markRow(batch.bid, bad.length ? 'failed' : 'done', bad.length ? `${bad.length} file(s) failed the integrity check` : 'Received');
    if (!bad.length) offerSaves(batch.bid, results);
    noteHistory('in', batch.files.length === 1 ? batch.files[0].name : `${batch.files.length} files`,
      batch.files.length, batch.total, peerName(link), link.mode, !bad.length);
    state.activeRecv = null;
    syncScreenLock();
    toast(bad.length ? 'Some files arrived corrupted.' : 'Received.', bad.length ? 'bad' : '');
  });

  recv.on('failed', (error) => {
    markRow(batch.bid, 'failed', error.message || 'Could not save file');
    state.activeRecv = null;
    syncScreenLock();
    toast('Could not receive the file. Check available storage and retry.', 'warn');
  });

  recv.on('cancelled', () => {
    markRow(batch.bid, 'failed', 'Cancelled by sender');
    state.activeRecv = null;
    syncScreenLock();
  });

  syncScreenLock();
  askToNotify();
  recv.begin();
  link.send({ t: 'batch-ok', bid: batch.bid, receipts: 1 });
  state.pending = null;
}

/** Cycle Tab within the incoming-files dialog. */
function trapAskFocus(e) {
  if (e.key !== 'Tab') return;
  const sheet = $('ask');
  if (sheet.hidden) return;

  const focusable = [...sheet.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function closeAsk() {
  $('ask').hidden = true;
  document.removeEventListener('keydown', trapAskFocus, true);
  if (state.lastFocus && state.lastFocus.focus) {
    try { state.lastFocus.focus(); } catch {}
  }
  state.lastFocus = null;
}

function decline() {
  const { link, batch } = state.pending || {};
  closeAsk();
  if (link) link.send({ t: 'batch-no', bid: batch.bid });
  state.pending = null;
}

function offerSaves(bid, results) {
  const row = $(`row-${bid}`);
  if (!row) return;
  const unsaved = results.filter((r) => !r.saved);
  if (!unsaved.length) return;

  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:12px';
  const hint = document.createElement('p');
  hint.style.flexBasis = '100%';
  hint.textContent = 'Received in this browser. Tap Save below to keep the file on your device before closing this tab.';
  box.append(hint);
  for (const r of unsaved) {
    const a = document.createElement('a');
    a.className = 'save btn btn-go';
    a.href = r.url;
    // The name the browser writes to disk is sanitised, not the name that
    // arrived — a download attribute is a filename like any other.
    a.download = safeFilename(r.meta.name);
    a.textContent = `${t('send.save')} ${safeFilename(r.meta.name)}`;
    if (r.cleanup) {
      a.addEventListener('click', () => setTimeout(() => r.cleanup(), 60_000), { once: true });
    }
    box.append(a);
  }
  row.append(box);
}

function showNote(link, text) {
  const who = state.peers.get(link.peerId)?.name || 'A device';
  const el = document.createElement('div');
  el.className = 'received-note';
  el.innerHTML = `<div class="who">From ${esc(who)}</div>`;
  const body = document.createElement('div');
  body.textContent = text;
  el.append(body);

  const copy = document.createElement('button');
  copy.className = 'btn btn-quiet';
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.style.marginTop = '10px';
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
    catch { copy.textContent = 'Select it manually'; }
  };
  el.append(copy);

  $('notes').prepend(el);
  trace.connected();
  toast(t('toast.textReceived'));
}

/* -------------------------------------------------------------- rendering */

function showCode() {
  const token = `${state.code}${state.pin || ''}`;
  const url = `${location.origin}/#${token}`;

  $('codeOut').textContent = state.code;
  $('codeOut').dataset.empty = '0';
  $('pinRow').hidden = !state.pin;
  $('pinOut').textContent = state.pin || '';
  $('linkOut').value = url;
  if (!firstLiveLink()) setStatus($('pairNote'), t('pair.waiting'), 'off');

  // Keep the marker: replaceState with a null state would wipe what the
  // Android back handler checks for.
  history.replaceState({ kdrop: 'root' }, '', `#${state.code}${state.pin || ''}`);

  const box = $('qrBox');
  box.innerHTML = '';
  const img = new Image();
  img.src = qrSvgDataUrl(token);
  img.alt = `QR code for pairing code ${state.code}`;
  img.onerror = () => { box.innerHTML = '<span class="ph">Type the code<br>on the other device</span>'; };
  box.append(img);
}

function addPeer(p) {
  state.peers.set(p.id, { ...p, mode: 'connecting' });
  renderPeers();
}

function renderPeers() {
  const box = $('peers');
  const list = [...state.peers.values()];

  if (!list.length) {
    box.innerHTML = '<p class="empty">No other device yet.<br>Scan the code above with your phone.</p>';
    updateRoute();
    return;
  }

  box.innerHTML = list.map((p) => {
    const link = state.links.get(p.id);
    const live = p.mode === 'direct' || p.mode === 'relayed';
    const rtt = link?.rtt != null ? ` · ${link.rtt}ms` : '';
    const label = { direct: 'Direct connection', relayed: 'Encrypted relay', connecting: 'Connecting…', down: 'Disconnected' }[p.mode] || 'Connecting…';
    // Only shown once the device actually proved it holds the shared secret.
    const trustMark = link && link.trusted ? ` <span class="tick">${esc(t('trust.tick'))}</span>` : '';
    return `
      <div class="peer ${live ? 'live' : ''}">
        <span class="dot"></span>
        <span>
          <span class="nm">${esc(p.name)}${trustMark}</span>
          <span class="rt">${label}${rtt}</span>
        </span>
        <span class="kind">${esc(p.kind || '')}</span>
      </div>`;
  }).join('');

  updateRoute();
}

function addRow(id, name, size, status) {
  const box = $('transfers');
  if (box.querySelector('.empty')) box.innerHTML = '';
  const el = document.createElement('div');
  el.className = 't';
  el.id = `row-${id}`;
  el.innerHTML = `
    <div class="r1"><span class="nm">${esc(name)}</span><span class="sz">${fmtBytes(size)}</span></div>
    <div class="bar"><div class="fill"></div></div>
    <div class="r2"><span class="st">${esc(status)}</span><span class="dt"></span></div>`;
  box.prepend(el);
}

function updateRow(id, pct, left, right) {
  const el = $(`row-${id}`);
  if (!el) return;
  el.querySelector('.fill').style.width = `${Math.min(pct, 100).toFixed(1)}%`;
  el.querySelector('.st').textContent = left;
  el.querySelector('.dt').textContent = right;
}

/** Each row owns its measurements; no extra timer survives a finished transfer. */
function renderSpeed(id, link, bytes, extra = {}) {
  const row = $(`row-${id}`);
  if (!row || row.classList.contains('done') || row.classList.contains('failed')) return;
  const now = performance.now();
  const monitor = row.speedMonitor ||= { meter: new SpeedMeter(), nextStats: 0, stats: null,
    rendered: -Infinity, writeMs: 0, writeSamples: 0, busy: 0, samples: 0 };
  if (monitor.link !== link || monitor.mode !== link.mode) {
    monitor.link = link; monitor.mode = link.mode; monitor.stats = null; monitor.nextStats = 0;
  }
  if (now >= monitor.nextStats) {
    monitor.nextStats = now + 2000;
    readStats(link).then(stats => {
      if (monitor.link === link && monitor.mode === link.mode) monitor.stats = stats;
    }).catch(() => {});
  }
  const measured = monitor.meter.update(bytes || 0, now);
  if (now - monitor.rendered < 1000) return;
  if (Number.isFinite(extra.writeMs)) {
    const interval = now - monitor.rendered;
    monitor.busy = Number.isFinite(interval) && interval > 0
      ? Math.min(1, Math.max(0, extra.writeMs - monitor.writeMs) / interval) : 0;
    monitor.samples = extra.writeSamples - monitor.writeSamples;
    monitor.writeMs = extra.writeMs; monitor.writeSamples = extra.writeSamples;
  }
  monitor.rendered = now;
  const note = explainSpeed({ ...measured, mode: link.mode,
    stats: monitor.stats, paused: extra.paused, writeBusy: monitor.busy, writeSamples: monitor.samples });
  let panel = row.querySelector('.speed-panel');
  if (!panel) {
    panel = document.createElement('details'); panel.className = 'speed-panel';
    panel.innerHTML = '<summary>Transfer speed explained</summary><p class="speed-measure"></p><strong class="speed-title"></strong><p class="speed-detail"></p>';
    row.append(panel);
  }
  panel.querySelector('.speed-measure').textContent = `${fmtRate(measured.rate)} received · ${note.route}`;
  panel.querySelector('.speed-title').textContent = note.title;
  panel.querySelector('.speed-detail').textContent = note.detail;
}

/** Pause, resume and cancel buttons attached to the active transfer row. */
function setSenderControls(id, sender) {
  const el = $(`row-${id}`);
  if (!el) return;
  clearRowControls(id);

  const bar = document.createElement('div');
  bar.className = 'row-ctl';
  bar.id = `ctl-${id}`;

  const pause = document.createElement('button');
  pause.className = 'linkish';
  pause.type = 'button';
  pause.textContent = t('send.pause');
  pause.onclick = () => {
    if (sender.paused) { sender.play(); pause.textContent = t('send.pause'); }
    else { sender.pause(); pause.textContent = t('send.resume'); }
  };

  const cancel = document.createElement('button');
  cancel.className = 'linkish';
  cancel.type = 'button';
  cancel.textContent = t('send.cancel');
  cancel.onclick = () => sender.cancel();

  bar.append(pause, cancel);
  el.append(bar);
}

function clearRowControls(id) {
  const c = $(`ctl-${id}`);
  if (c) c.remove();
}

function markRow(id, cls, text) {
  const el = $(`row-${id}`);
  if (!el) return;
  el.classList.remove('done', 'failed', 'waiting');
  if (cls) el.classList.add(cls);
  el.querySelector('.st').textContent = text;
  if (cls === 'done') el.querySelector('.fill').style.width = '100%';
  if (cls === 'done' || cls === 'failed') {
    const title = el.querySelector('.speed-title');
    const detail = el.querySelector('.speed-detail');
    if (title) title.textContent = cls === 'done' ? 'Transfer complete' : 'Transfer stopped';
    if (detail) detail.textContent = cls === 'done'
      ? 'The receiver confirmed delivery. The speed above is the last measured sample.'
      : 'The speed above is the last measured sample; see the transfer status for the result.';
  }
}

// Declared as a function so it is hoisted — boot() uses it before this point.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------------- ui */

function wireUi() {
  $('pickFiles').onclick = (e) => { e.stopPropagation(); $('fileInput').click(); };
  $('pickFolder').onclick = (e) => { e.stopPropagation(); $('folderInput').click(); };
  $('fileInput').onchange = (e) => { sendFiles(e.target.files); e.target.value = ''; };
  $('folderInput').onchange = (e) => { sendFiles(e.target.files); e.target.value = ''; };

  const drop = $('drop');
  drop.onclick = () => { if (!$('cardSend').classList.contains('off')) $('fileInput').click(); };
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } };

  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!$('cardSend').classList.contains('off')) drop.classList.add('hot');
    });
  }
  for (const ev of ['dragleave', 'drop']) {
    document.addEventListener(ev, (e) => { e.preventDefault(); if (e.type === 'drop' || e.target === document) drop.classList.remove('hot'); });
  }
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('hot');
    if (e.dataTransfer?.files?.length) sendFiles(e.dataTransfer.files);
  });

  // Paste a file or an image straight onto the page.
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && firstLiveLink()) sendFiles(files);
  });

  $('tabFiles').onclick = () => switchTab('Files');
  $('tabText').onclick = () => switchTab('Text');
  $('sendNote').onclick = sendNote;
  $('noteBox').onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendNote(); };

  $('copyLink').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('linkOut').value);
      $('copyLink').textContent = 'Copied';
      setTimeout(() => ($('copyLink').textContent = 'Copy'), 1600);
    } catch {
      $('linkOut').select();
      toast(t('toast.copyManually'));
    }
  };

  $('joinForm').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length < 10) {
      return toast(t('toast.needPinLong'), 'bad');
    }
    if (joinWith(raw)) $('joinCode').value = '';
  };

  $('newRoom').onclick = () => { createRoom(); toast(t('toast.newCode')); };

  $('renameBtn').onclick = () => {
    const name = prompt('What should this device be called?', state.name);
    if (!name) return;
    state.name = name.slice(0, 24);
    localStorage.setItem('kdrop.name', state.name);
    signal.send({ t: 'rename', name: state.name });
    toast(`This device is now "${state.name}".`);
  };

  const jump = () => document.getElementById('app').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  $('ctaSend').onclick = () => setRole('send', { jump: true });
  $('ctaReceive').onclick = () => setRole('receive', { jump: true });
  $('roleSwap').onclick = () => setRole(state.role === 'send' ? 'receive' : 'send');

  $('clearHistory').onclick = () => {
    recent.clear();
    renderHistory();
    $('cardHistory').hidden = true;
    toast(t('toast.historyCleared'));
  };

  $('askYes').onclick = accept;
  $('askNo').onclick = decline;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ask').hidden) decline(); });

  // Warn before closing mid-transfer.
  window.addEventListener('beforeunload', (e) => {
    if (state.activeSend || state.activeRecv) { e.preventDefault(); e.returnValue = ''; }
  });
}

function switchTab(which) {
  const files = which === 'Files';
  $('tabFiles').setAttribute('aria-selected', String(files));
  $('tabText').setAttribute('aria-selected', String(!files));
  $('paneFiles').hidden = !files;
  $('paneText').hidden = files;
}

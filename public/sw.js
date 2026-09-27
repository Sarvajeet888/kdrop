/**
 * K-Drop service worker — offline shell only.
 *
 * Caches the interface so the page opens without an internet connection.
 * It deliberately does NOT touch anything to do with transfers: no file data,
 * no pairing codes, no API responses. Those must always be live.
 */

// Bump this on every deploy that changes a file in SHELL. The old cache is
// deleted on activate, so a stale copy of app.js cannot survive an update and
// pair against the new protocol.
const VERSION = 'kdrop-v10-hardening';
const SHELL = [
  '/',
  '/index.html',
  '/assets/kdrop.css',
  '/assets/studio.css',
  '/assets/studio.js',
  '/assets/app.js',
  '/assets/core.js',
  '/assets/trace.js',
  '/assets/art.js',
  '/assets/trust.js',
  '/assets/filename.js',
  '/assets/scan.js',
  '/assets/qr.js',
  '/assets/i18n.js',
  '/assets/history.js',
  '/assets/favicon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // addAll fails wholesale if any single item 404s, so add individually.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Android share sheet.
 *
 * When someone picks K-Drop from "Share" in their gallery, Android POSTs the
 * files to /share. That POST never reaches the network — we take the files
 * here, stash them, and redirect to the app, which collects them on load.
 * Doing it any other way would mean uploading the files to a server, which is
 * the exact thing K-Drop exists to avoid.
 */
const SHARE_CACHE = 'kdrop-share';

self.addEventListener('fetch', (e) => {
  const { request } = e;

  if (request.method === 'POST' && new URL(request.url).pathname === '/share') {
    e.respondWith((async () => {
      try {
        const form = await request.formData();
        const files = form.getAll('files').filter((f) => f && f.size !== undefined);
        const text = [form.get('title'), form.get('text'), form.get('url')]
          .filter(Boolean).join('\n').trim();

        const cache = await caches.open(SHARE_CACHE);
        // A Response is the only thing a Cache will hold, so each file is
        // wrapped in one and handed back to the page as a Blob.
        await cache.put('/__share_meta', new Response(JSON.stringify({
          at: Date.now(),
          text,
          files: files.map((f) => ({ name: f.name || 'shared', type: f.type || '' })),
        })));
        for (let i = 0; i < files.length; i++) {
          await cache.put(`/__share_file_${i}`, new Response(files[i]));
        }
        return Response.redirect('/?shared=1', 303);
      } catch {
        return Response.redirect('/?shared=error', 303);
      }
    })());
    return;
  }

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Never cache anything live: pairing, config and health.
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/__share')) return;   // handed to the page, not cached as shell

  // Network first, so a deployed update is picked up immediately. The cache
  // is the fallback for when there is no connection at all.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(request).then((hit) => hit || caches.match('/index.html'))
      )
  );
});

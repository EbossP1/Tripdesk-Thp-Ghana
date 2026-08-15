/* ═══════════════════════════════════════════════════════════
   THP-GHANA TRIPDESK — Service Worker
   ─────────────────────────────────────────
   Strategy: NETWORK-FIRST for app files.
   This is deliberate. It means:
     • When online, the browser ALWAYS gets the freshest file
       from GitHub Pages — it never serves a stale cached copy.
       (This is what prevents the "staff sees the old version"
        problem that a naive cache-first service worker causes.)
     • When offline, it falls back to the last cached copy so the
       app shell still opens.

   ⚠ ON EVERY DEPLOY: bump CACHE_VERSION below (v1 → v2 → …).
     That single change clears the old cache for every user.
═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'tripdesk-v14';   // ← bump this on every deploy
const CACHE_NAME = CACHE_VERSION;

// Core files that make up the app shell (cached for offline fallback)
const SHELL_FILES = [
  './',
  './index.html',
  './td-styles.css',
  './td-app.js',
  './thp_logo.png',
  './manifest.json'
];

// ── INSTALL — pre-cache the shell, then activate immediately ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES).catch(() => {/* ignore missing optional files */}))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — delete any old-version caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — network-first for our files, pass everything else through ──
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests on our own origin.
  // Supabase / Arkesel / Google API calls pass straight through to the network,
  // untouched — we never cache live data or notification calls.
  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res => {
        // Got a fresh copy online — update the cache and return it.
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        // Offline — fall back to cache, or the cached index.html for navigations.
        caches.match(req).then(hit => hit || caches.match('./index.html'))
      )
  );
});

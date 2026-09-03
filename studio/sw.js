// Service worker: makes the web app installable and resilient.
//
// Strategy is deliberately network-first for everything: this session has
// already proven how painful stale JS caches are during development, and in
// production an app about correctness must never run old logic silently.
// The cache is a fallback for flaky Wi-Fi and offline opens, not a speedup.

const CACHE = 'materiallogix-shell-v20';
const PEOPLE_CACHE = 'materiallogix-people-proof-v1';
const SHELL = [
  './', 'index.html', 'voice.html', 'usage.html', 'admin.html', 'manifest.webmanifest', 'icon.svg',
  'css/app.css', 'css/studio-entry.css', 'assets/preview-stamp.wav',
  'js/bootstrap.js', 'js/studio-shell.js', 'js/studio-nav.js', 'js/api-root.js', 'js/activity.js', 'js/privacy.js',
  'js/studio-entry.js',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/crop.js', 'js/analyze.js',
  'js/export.js', 'js/clientpage.js', 'js/history.js', 'js/zip.js',
  'js/generate.js', 'js/inpaint-foundation.js', 'js/cloud-video.js', 'js/spin-viewer.js', 'js/geometry.js', 'js/human-geometry.js', 'js/device.js', 'js/raw.js', 'js/voice.js',
  'js/editing.js', 'js/print.js', 'js/house-voices.js', 'js/voice-quality.js', 'js/voice-reference.js', 'js/color-management.js',
  'js/pricing.js', 'js/pricing-catalog.js', 'js/license.js', 'js/license-key.js'
  ,'js/billing-client.js', 'js/usage.js', 'js/admin.js',
  'assets/raw/worker.js',
  '../media/studio-entry-photo.webp', '../media/studio-entry-video.webp', '../media/studio-entry-voice.webp'
];
// Every shell entry is relative to this worker's own URL (/studio/sw.js), not to
// the origin. Resolving against the origin produced /index.html and /js/app.js,
// which are not paths this app is ever served from, so the fetch handler below
// matched nothing and the cache was never read. One resolver, used by both the
// precache and the fetch matcher, keeps them from drifting apart again.
const resolveShell = path => new URL(path, self.location.href);
const SHELL_PATHS = new Set(SHELL.map(path => resolveShell(path).pathname));
// Proof-only candidate assets are warmed only when the explicit parity suite
// runs. Keeping 14 MiB out of the mandatory shell protects normal installs.
const PEOPLE_ASSETS = [
  'assets/human/human.esm.js',
  'assets/human/models/blazeface.json', 'assets/human/models/blazeface.bin',
  'assets/human/models/facemesh.json', 'assets/human/models/facemesh.bin',
  'assets/human/models/handtrack.json', 'assets/human/models/handtrack.bin',
  'assets/human/models/handlandmark-lite.json', 'assets/human/models/handlandmark-lite.bin',
  'assets/human/models/movenet-lightning.json', 'assets/human/models/movenet-lightning.bin',
  'assets/human/models/blazepose-full.json', 'assets/human/models/blazepose-full.bin'
];
const PEOPLE_PATHS = new Set(PEOPLE_ASSETS.map(path => resolveShell(path).pathname));
const NETWORK_TIMEOUT_MS = 1200;

async function networkFirst(request, event, cacheName = CACHE) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(request, { cache: 'no-store', signal: controller.signal });
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(cacheName).then(cache => cache.put(request, copy)).catch(() => undefined));
    }
    return response;
  } catch {
    return (await caches.open(cacheName).then(cache => cache.match(request, { ignoreSearch: true }))) || new Response(
      '<!doctype html><title>Material Logic Studio offline</title><h1>Offline shell unavailable</h1><p>Reconnect once to repair the application shell. Your project data has not been deleted.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  } finally {
    clearTimeout(timer);
  }
}

// cache.addAll() is all-or-nothing: one 404 in the shell list rejects the whole
// install, and the worker never activates at all. The shell is a resilience
// fallback, so warm it entry by entry and let a single missing asset cost only
// that asset. shellPrecacheFailures() surfaces what did not warm so a stale
// path is a visible defect instead of a silently uninstallable app.
const precacheFailures = [];

async function warmShell(cache) {
  precacheFailures.length = 0;
  await Promise.all(SHELL.map(async path => {
    try {
      const request = new Request(resolveShell(path), { cache: 'reload' });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await cache.put(request, response);
    } catch (error) {
      precacheFailures.push(`${path}: ${error?.message || 'unavailable'}`);
    }
  }));
  if (precacheFailures.length) console.warn('[sw] shell assets that did not precache', precacheFailures);
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => warmShell(cache)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== PEOPLE_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only the declared shell may be cached. API/account responses must never be
  // persisted by the offline cache. This includes same-origin production APIs
  // and the absolute license/billing origin used by local and installed builds.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  if (PEOPLE_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(event.request, event, PEOPLE_CACHE));
    return;
  }
  if (SHELL_PATHS.has(url.pathname)) event.respondWith(networkFirst(event.request, event));
});

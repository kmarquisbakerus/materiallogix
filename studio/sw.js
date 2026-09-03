// Service worker: makes the web app installable and resilient.
//
// Strategy is deliberately network-first for everything: this session has
// already proven how painful stale JS caches are during development, and in
// production an app about correctness must never run old logic silently.
// The cache is a fallback for flaky Wi-Fi and offline opens, not a speedup.

const CACHE = 'materiallogix-shell-v19';
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
  'site/media/studio-entry-photo.webp', 'site/media/studio-entry-video.webp', 'site/media/studio-entry-voice.webp'
];
const SHELL_PATHS = new Set(SHELL.map(path => new URL(path, self.location.origin).pathname));
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
const PEOPLE_PATHS = new Set(PEOPLE_ASSETS.map(path => new URL(path, self.location.origin).pathname));
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
      '<!doctype html><title>MaterialLogix Studio offline</title><h1>Offline shell unavailable</h1><p>Reconnect once to repair the application shell. Your project data has not been deleted.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
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

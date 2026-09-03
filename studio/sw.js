// Service worker: makes the web app installable and resilient.
//
// Strategy is deliberately network-first for everything: this session has
// already proven how painful stale JS caches are during development, and in
// production an app about correctness must never run old logic silently.
// The cache is a fallback for flaky Wi-Fi and offline opens, not a speedup.

const CACHE = 'materiallogix-shell-v21';
const PEOPLE_CACHE = 'materiallogix-people-proof-v1';
// Every module the four pages import, plus the stylesheets they link. An
// installed copy that is missing one of these does not degrade - it fails to
// start. `npm test` walks the real import graph and fails if this list drifts.
const SHELL = [
  './', 'index.html', 'voice.html', 'usage.html', 'admin.html', 'manifest.webmanifest', 'icon.svg',
  'css/app.css', 'css/studio-entry.css', 'css/usage.css', 'css/admin.css',
  'assets/preview-stamp.wav',
  'js/bootstrap.js', 'js/studio-shell.js', 'js/studio-nav.js', 'js/api-root.js', 'js/activity.js', 'js/privacy.js',
  'js/studio-entry.js', 'js/app-version.js', 'js/features.js', 'js/prompt-guard.js', 'js/account-providers.js',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/crop.js', 'js/analyze.js',
  'js/export.js', 'js/clientpage.js', 'js/history.js', 'js/zip.js',
  'js/generate.js', 'js/inpaint-foundation.js', 'js/cloud-video.js', 'js/spin-viewer.js', 'js/geometry.js', 'js/human-geometry.js', 'js/device.js', 'js/raw.js', 'js/raw-preview.js', 'js/voice.js',
  'js/capture-guidance.js', 'js/capture-pacer.js', 'js/video-plan.js',
  'js/editing.js', 'js/print.js', 'js/house-voices.js', 'js/voice-quality.js', 'js/voice-reference.js', 'js/color-management.js',
  'js/plural.js', 'js/service-error.js',
  'js/pricing.js', 'js/license.js', 'js/license-key.js',
  'js/billing-client.js', 'js/usage.js', 'js/admin.js',
  'assets/raw/worker.js'
];

// Paths resolve against this worker's own directory, which is where `addAll`
// stores them. Resolving against the origin instead would build a lookup set
// of `/js/app.js` while the cache held `/studio/js/app.js`, and the fetch
// handler would never match a single shell request.
const shellPath = path => new URL(path, self.location.href).pathname;
const SHELL_PATHS = new Set(SHELL.map(shellPath));
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
const PEOPLE_PATHS = new Set(PEOPLE_ASSETS.map(shellPath));
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

self.addEventListener('install', event => {
  // addAll is all-or-nothing: one unreachable entry leaves the cache empty and
  // the app with no offline shell at all. Add each entry on its own, then fail
  // the install only if something the app cannot start without is missing.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.allSettled(SHELL.map(path => cache.add(path)));
    const failed = SHELL.filter((_, index) => results[index].status === 'rejected');
    if (failed.length) {
      // Report every missing entry at once; a partial shell is a broken shell.
      throw new Error(`Offline shell incomplete: ${failed.join(', ')}`);
    }
    await self.skipWaiting();
  })());
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

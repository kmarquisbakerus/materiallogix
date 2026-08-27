// Service worker: makes the web app installable and resilient.
//
// Strategy is deliberately network-first for everything: this session has
// already proven how painful stale JS caches are during development, and in
// production an app about correctness must never run old logic silently.
// The cache is a fallback for flaky Wi-Fi and offline opens, not a speedup.

const CACHE = 'materiallogix-shell-v3';
const SHELL = [
  './', 'index.html', 'voice.html', 'manifest.webmanifest', 'icon.svg',
  'css/app.css', 'assets/preview-stamp.wav',
  'js/bootstrap.js', 'js/studio-shell.js', 'js/activity.js',
  'js/app.js', 'js/model.js', 'js/store.js', 'js/crop.js', 'js/analyze.js',
  'js/export.js', 'js/clientpage.js', 'js/history.js', 'js/zip.js',
  'js/generate.js', 'js/geometry.js', 'js/device.js', 'js/voice.js',
  'js/pricing.js', 'js/license.js', 'js/license-key.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only same-origin GETs. Bridge calls (:8189) and CDNs pass straight through.
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

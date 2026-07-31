/* ==========================================================================
   Service worker for the Burren map + Scriptorium.
   Lives at the repo root (not inside /scriptorium/) so its default scope
   covers the whole site, including burren-real-map.html — a service
   worker registered from a subdirectory can only ever control that
   subdirectory and below, without a server-side Service-Worker-Allowed
   header GitHub Pages doesn't let you set.

   Strategy: stale-while-revalidate, runtime-only (no hardcoded precache
   manifest to keep in sync as pages are added) — same-origin GET
   requests only. Anything already cached is served instantly while a
   fresh copy is fetched in the background for next time; first visit to
   any URL still goes to the network like normal.
   ========================================================================== */
var CACHE_NAME = 'burren-scriptorium-v1';

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave CDN requests (MapLibre, OpenFreeMap tiles, OSRM) alone entirely
  event.respondWith(staleWhileRevalidate(req));
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var networkFetch = fetch(req).then(function (networkResponse) {
        if (networkResponse && networkResponse.ok) cache.put(req, networkResponse.clone());
        return networkResponse;
      }).catch(function () { return cached; }); // offline (or network error): fall back to whatever's cached
      return cached || networkFetch;
    });
  });
}

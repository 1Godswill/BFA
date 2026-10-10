/* UBC Finance service worker — caches everything the app needs so it works fully offline
   once loaded the first time. Bump CACHE_NAME when you change any file so the new version
   is fetched instead of the stale cached one. */

const CACHE_NAME = "ubc-finance-v1.3";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./sync.js",
  "./zip-writer.js",
  "./pdf-writer.js",
  "./seed-data.js",
  "./manifest.json",
  "./img/logo.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // cache anything same-origin we successfully fetch, so future offline loads have it too
        if (response && response.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

const CACHE = "cholscore-v168";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
  "./workout-victory-silhouette.png",
  "./walk-share-template.jpg",
  "./run-share-template.jpeg",
  "./splash/apple-splash-750x1334.png",
  "./splash/apple-splash-1125x2436.png",
  "./splash/apple-splash-828x1792.png",
  "./splash/apple-splash-1242x2688.png",
  "./splash/apple-splash-1170x2532.png",
  "./splash/apple-splash-1284x2778.png",
  "./splash/apple-splash-1179x2556.png",
  "./splash/apple-splash-1290x2796.png",
  "./splash/apple-splash-1206x2622.png",
  "./splash/apple-splash-1320x2868.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("cholscore-") && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const url = new URL(request.url);

  // Product lookups must always be live.
  if (url.hostname.includes("openfoodfacts.org")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation and core app files: network first so new releases arrive
  // immediately, with cache only as an offline fallback.
  const isCore =
    request.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/styles.css") ||
    url.pathname.endsWith("/manifest.json");

  if (isCore) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached =>
            cached || (request.mode === "navigate" ? caches.match("./index.html") : undefined)
          )
        )
    );
    return;
  }

  // Images and other static assets can remain cache-first.
  event.respondWith(
    caches.match(request).then(cached =>
      cached || fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
    )
  );
});

/**
 * wallet-voice-call Service Worker
 * Safely caches static application shell assets (scripts, styles, icons).
 * Strictly bypasses caching for all real-time WebSockets and authenticated API requests.
 */

const CACHE_NAME = "wallet-voice-call-shell-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/liquid-orb.jpg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Never cache API endpoints, authentication routes, or WebSockets
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws") ||
    event.request.method !== "GET"
  ) {
    return; // Pass through to network
  }

  // 2. Network-first strategy with cache fallback for shell navigation
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match("/index.html") as Promise<Response>;
      })
    );
    return;
  }

  // 3. Cache-first strategy for static immutable assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        // Cache valid static responses
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (url.pathname.endsWith(".js") ||
            url.pathname.endsWith(".css") ||
            url.pathname.endsWith(".jpg") ||
            url.pathname.endsWith(".png") ||
            url.pathname.endsWith(".woff2"))
        ) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});

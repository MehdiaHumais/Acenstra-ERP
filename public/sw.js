/* Ascentra Food Distribution ERP — offline-first PWA service worker.
 *
 * Strategy
 *   /, /login, /signup and icons           → precached, cache-first
 *   Navigations (pages)                    → network-first, cache fallback,
 *                                            `/offline` shell if offline & not cached
 *   Hashed static assets (/_next/static/)  → cache-first (immutable per build)
 *   Everything else                        → network only (never caches private API data)
 *
 * Cache is versioned — old buckets are purged and open tabs are reloaded
 * on activation, so a new deploy always takes effect.
 */

const CACHE_VERSION = "ascentra-erp-v7";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE = [
  "/",
  "/login",
  "/signup",
  "/manifest.json",
  "/logo.png",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png"
];

const NAVIGATION_TIMEOUT_MS = 8000;
const ASSET_TIMEOUT_MS = 4000;

function timeoutFetch(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE.map((path) =>
          cache.add(new Request(path, { cache: "reload" })).catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const staleCaches = keys.filter((key) => !key.startsWith(CACHE_VERSION));
      await Promise.all(staleCaches.map((key) => caches.delete(key)));
      await self.clients.claim();

      // Force open tabs onto the new bundle rather than serving stale code.
      if (staleCaches.length > 0) {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        await Promise.all(
          clients.map(async (client) => {
            try {
              client.postMessage({ type: "RELOAD_FOR_UPDATE" });
            } catch {
              // client may already be gone
            }
            if (typeof client.navigate === "function") {
              try {
                await client.navigate(client.url);
              } catch {
                // navigation unavailable; the message listener will handle it
              }
            }
          })
        );
      }
    })()
  );
});

const OFFLINE_RESPONSE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ascentra ERP — Offline</title><style>body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#061222;color:#ffffff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:2rem}main{max-width:24rem;text-align:center}h1{font-size:1.4rem;margin:0 0 .5rem}p{color:#a9bcc9;font-size:.95rem;line-height:1.5}</style></head><body><main><h1>You are offline</h1><p>Ascentra needs a network connection to sign you in and load live data. Check your connection, then <a href="/login" style="color:#fff;text-decoration:underline">try again</a>.</p></main></body></html>`;

async function handleNavigation(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await timeoutFetch(request, NAVIGATION_TIMEOUT_MS);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // Offline (or slow): prefer the cached page; if unknown, fall back to the shell.
    const cached = await cache.match(request);
    if (cached) return cached;
    const root = await caches.match("/");
    if (root) return root;
    return new Response(OFFLINE_RESPONSE, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
}

async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await timeoutFetch(request, ASSET_TIMEOUT_MS);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      await trimCache(STATIC_CACHE, 150);
    }
    return response;
  } catch (error) {
    return new Response("", { status: 504, statusText: "Gateway Timeout" });
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!request || request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/logo") ||
    url.pathname.startsWith("/manifest") ||
    url.pathname.startsWith("/apple-touch-icon") ||
    url.pathname.startsWith("/favicon")
  ) {
    event.respondWith(handleStaticAsset(request));
    return;
  }

  // All other requests (including APIs) bypass the cache by default.
});

self.addEventListener("sync", (event) => {
  if (event.tag === "ascentra-sync") {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        await Promise.all(
          clients.map((client) => client.postMessage({ type: "SYNC_OFFLINE_QUEUE" }))
        );
      })()
    );
  }
});

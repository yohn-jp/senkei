const CACHE_NAME = "senkei-web-offline-v1";
const CACHE_PREFIX = "senkei-web-offline-";
const APP_SHELL_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.type !== "CACHE_URLS" || !Array.isArray(message.urls)) return;
  event.waitUntil(cacheUrls(message.urls).finally(() => {
    event.ports[0]?.postMessage({ type: "CACHE_URLS_COMPLETE" });
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(request.mode === "navigate"
    ? navigationResponse(request)
    : assetResponse(request));
});

async function cacheUrls(values) {
  const cache = await caches.open(CACHE_NAME);
  const urls = [...new Set(values.filter((value) => typeof value === "string"))];
  await Promise.all(urls.map(async (value) => {
    let url;
    try {
      url = new URL(value, self.location.origin);
    } catch {
      return;
    }
    if (url.origin !== self.location.origin) return;
    try {
      const response = await fetch(url.href, { credentials: "same-origin" });
      if (cacheable(response)) await cache.put(url.href, response.clone());
    } catch {
      // The normal fetch handler will keep already cached assets usable offline.
    }
  }));
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  let response;
  try {
    response = await fetch(request);
  } catch {
    return (await cache.match(request)) ||
      (await cache.match("/")) ||
      (await cache.match("/index.html")) ||
      new Response("Senkei is unavailable offline until its local app shell has been loaded once.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
  }
  if (cacheable(response)) {
    try {
      await cache.put("/", response.clone());
      await cache.put("/index.html", response.clone());
    } catch {
      // Keep the network response usable even when the browser cannot cache it.
    }
  }
  return response;
}

async function assetResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  // Same-origin resources may be cached by the explicit asset pass using a
  // fetch request with different Vary headers than the browser's module load.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  let response;
  try {
    response = await fetch(request);
  } catch {
    return new Response("This Senkei asset has not been cached on this device yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (cacheable(response)) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // Keep the network response usable even when the browser cannot cache it.
    }
  }
  return response;
}

function cacheable(response) {
  if (!response.ok || response.type === "opaque") return false;
  return response.headers.get("Cache-Control")?.toLowerCase().includes("no-store") !== true;
}

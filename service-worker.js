const CACHE_NAME = 'blocos-rj-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];
const DATA_PATHS = new Set(['/blocos.csv', '/metro_stations.json']);
const DATA_MAX_AGE_MS = 6 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestURL = new URL(event.request.url);
  const isSameOrigin = requestURL.origin === self.location.origin;
  const isDataRequest = isSameOrigin && DATA_PATHS.has(requestURL.pathname);
  const isNavigation = event.request.mode === 'navigate';

  if (isDataRequest) {
    event.respondWith(networkFirstData(event.request));
    return;
  }

  if (isNavigation) {
    event.respondWith(networkFirstAppShell(event.request));
    return;
  }

  event.respondWith(cacheFirstWithNavigateFallback(event.request));
});

async function networkFirstData(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, withCacheTimestamp(networkResponse));
    }
    return networkResponse;
  } catch (_) {
    const cached = await cache.match(request);
    if (!cached) {
      return Response.error();
    }

    const cachedAt = Number(cached.headers.get('sw-fetched-at') || '0');
    const isFreshEnough = cachedAt && (Date.now() - cachedAt) <= DATA_MAX_AGE_MS;

    if (!isFreshEnough) {
      return Response.error();
    }

    return cached;
  }
}

async function cacheFirstWithNavigateFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok && request.url.startsWith(self.location.origin)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }

    return Response.error();
  }
}

async function networkFirstAppShell(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok && request.url.startsWith(self.location.origin)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('./index.html');
  }
}

function withCacheTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-fetched-at', String(Date.now()));

  return response.blob().then((body) =>
    new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  );
}

const CACHE_NAME = 'blocos-rj-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

const DATA_MAX_AGE_MS = 6 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const allowedCaches = [CACHE_NAME];
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => {
        if (!allowedCaches.includes(key)) {
          return caches.delete(key);
        }
        return Promise.resolve();
      }),
    );
  })());

  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestURL = new URL(event.request.url);
  const isSameOrigin = requestURL.origin === self.location.origin;
  const isDataRequest = requestURL.pathname.endsWith('blocos.csv')
    || requestURL.pathname.endsWith('metro_stations.json');

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (isDataRequest) {
    event.respondWith(networkFirstData(event.request));
    return;
  }

  if (isSameOrigin && isStaticAssetRequest(requestURL.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // External APIs (weather/geocoding) and other requests
  event.respondWith(networkFirstExternal(event.request));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cachedPage = await caches.match(request);
    if (cachedPage) return cachedPage;
    return caches.match('./index.html');
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }

  const networkResponse = await networkFetch;
  return networkResponse || Response.error();
}

async function networkFirstData(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, await withCacheTimestamp(networkResponse));
    }
    return networkResponse;
  } catch (_) {
    const cached = await cache.match(request);
    if (!cached) return Response.error();

    const cachedAt = Number(cached.headers.get('sw-fetched-at') || '0');
    const isFreshEnough = cachedAt && (Date.now() - cachedAt) <= DATA_MAX_AGE_MS;

    if (!isFreshEnough) {
      return Response.error();
    }

    return cached;
  }
}

async function networkFirstExternal(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, await withCacheTimestamp(networkResponse));
    }
    return networkResponse;
  } catch (_) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

function isStaticAssetRequest(pathname) {
  return pathname.endsWith('.html')
    || pathname.endsWith('.css')
    || pathname.endsWith('.js')
    || pathname.endsWith('.json')
    || pathname.endsWith('.svg')
    || pathname.endsWith('.png')
    || pathname.endsWith('.jpg')
    || pathname.endsWith('.jpeg')
    || pathname.endsWith('.webp')
    || pathname.endsWith('.ico');
}

async function withCacheTimestamp(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-fetched-at', String(Date.now()));

  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

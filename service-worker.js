// Runtime cache generation. Bump this whenever the production shell changes so
// installed PWAs cannot keep the previous shell generation after activation.
const CACHE_NAME = 'puffer-shell-v13-static-assets';
const STATIC_ASSET_VERSION = '20260814-static-assets-1';
const CORE_TIMEOUT_MS = 8000;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isAlwaysFresh(request) {
  const url = new URL(request.url);
  return url.pathname === '/version.json' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    /\.(?:js|css)$/.test(url.pathname);
}

function isStaticAsset(request) {
  return new URL(request.url).pathname.startsWith('/assets/');
}

function versionedAssetRequest(request) {
  const url = new URL(request.url);
  // Normalize every first-party asset to the same release key. This also
  // replaces older ad-hoc values such as ?v=1 or blink-specific revisions.
  url.searchParams.set('v', STATIC_ASSET_VERSION);
  return new Request(url.href, request);
}

async function fetchStaticAsset(request) {
  const versioned = versionedAssetRequest(request);
  const cached = await caches.match(versioned);
  const update = fetch(new Request(versioned, { cache: 'no-store' })).then(response => {
    if (response.ok) {
      caches.open(CACHE_NAME).then(cache => cache.put(versioned, response.clone())).catch(() => {});
    }
    return response;
  }).catch(() => cached || caches.match(request));
  return cached || update;
}

async function fetchFresh(request, fallback = true) {
  const cached = fallback ? await caches.match(request) : null;
  try {
    const response = await Promise.race([
      fetch(new Request(request, { cache: 'no-store' })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('network-timeout')), CORE_TIMEOUT_MS))
    ]);
    if (response.ok && new URL(request.url).pathname !== '/version.json') {
      const copy = response.clone();
      await caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  } catch (_) {
    return cached || fetch(request);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
  if (isStaticAsset(request)) {
    event.respondWith(fetchStaticAsset(request));
    return;
  }
  if (request.mode === 'navigate' || isAlwaysFresh(request)) {
    event.respondWith(fetchFresh(request));
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const update = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())).catch(() => {});
      return response;
    }).catch(() => cached);
    return cached || update;
  })());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data?.text?.() || '有新的共同生活更新。' }; }
  // Declarative Web Push nests the visible fields under `notification`.
  // Older browsers still run this handler, so display the same standardized
  // payload imperatively for backwards compatibility.
  const visible = data.notification || data;
  const metadata = visible.data || data.data || {};
  const target = visible.navigate || metadata.url || data.url || '/';
  const notification = self.registration.showNotification(visible.title || '胖头鱼的共同生活', {
    body: visible.body || '有新的共同生活更新。',
    icon: visible.icon || '/assets/puffer-192.png',
    badge: '/assets/puffer-192.png',
    tag: visible.tag || 'puffer-room-update',
    renotify: true,
    data: { url: target, kind: metadata.kind || data.kind || '', recordId: metadata.recordId || data.recordId || '' }
  });
  const refreshClients = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => client.postMessage({ type: 'puffer-room-update', kind: metadata.kind || data.kind || '', recordId: metadata.recordId || data.recordId || '' }));
  });
  event.waitUntil(Promise.all([notification, refreshClients]));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => 'focus' in client);
    if (existing) {
      const kind = event.notification.data?.kind || '';
      existing.postMessage({ type: kind ? 'puffer-open-notification' : 'puffer-room-update', kind });
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});

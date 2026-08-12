const CACHE_NAME = 'puffer-shell-v3-fast-assets';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// 主屏幕 PWA 打开时，导航页始终优先读取线上版本，避免一直复用旧的 HTML 壳。
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      try {
        const fresh = await Promise.race([
          fetch(new Request(request, { cache: 'no-store' })),
          new Promise((_, reject) => setTimeout(() => reject(new Error('network-timeout')), 4500))
        ]);
        const copy = fresh.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {}));
        return fresh;
      } catch (_) { return cached || fetch(request); }
    })());
    return;
  }
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
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
  const title = data.title || '胖头鱼的共同生活';
  const options = {
    body: data.body || '有新的共同生活更新。',
    icon: '/assets/puffer-192.png',
    badge: '/assets/puffer-192.png',
    tag: data.tag || 'puffer-room-update',
    renotify: true,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => 'focus' in client);
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});

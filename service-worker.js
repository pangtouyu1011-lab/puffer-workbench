const CACHE_NAME = 'puffer-shell-v2-settings-fullscreen';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// 主屏幕 PWA 打开时，导航页始终优先读取线上版本，避免一直复用旧的 HTML 壳。
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(new Request(event.request, { cache: 'no-store' })));
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

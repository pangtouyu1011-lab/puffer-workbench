// Keep one release identifier across index.html, version.json and every cache key.
const CACHE_PREFIX = 'puffer-';
const CACHE_NAME = 'puffer-shell-v26-reaction-feedback';
const RUNTIME_CACHE_NAME = 'puffer-runtime-v26-reaction-feedback';
const STATIC_ASSET_VERSION = '20260820-reaction-feedback-1';
const CORE_TIMEOUT_MS = 8000;
const WARM_CACHE_BATCH_SIZE = 6;

const versionedPath = path => `${path}?v=${STATIC_ASSET_VERSION}`;
const FONT_ASSET_FILES = [
  'inter-ui.woff2',
  ...Array.from({ length: 14 }, (_, index) => `noto-sans-sc-ui-${String(index + 1).padStart(2, '0')}.woff2`),
  ...Array.from({ length: 14 }, (_, index) => `noto-serif-sc-ui-${String(index + 1).padStart(2, '0')}.woff2`)
];
const CRITICAL_SHELL_FILES = [
  'styles.css', 'legacy-dashboard.css', 'legacy-training.css', 'legacy-navigation.css',
  'life.css', 'life-ritual.css', 'life-dashboard.css', 'life-dashboard-music.css', 'life-complete-state.css',
  'challenge-questions.js', 'features/music/music-apple-data.js', 'features/music/music-netease-data.js', 'features/music/music-data.js', 'features/music/music-state.js',
  'features/music/music-recommend.js', 'features/music/music-reason.js', 'features/music/music-view.js',
  'app.js', 'push.js', 'life.js', 'life-complete-state.js',
  'assets/qrcodejs-1.0.0.min.js', 'assets/fonts/fonts.css',
  'assets/icons/phosphor/phosphor-regular.css', 'assets/icons/phosphor/Phosphor.woff2'
];
const WARM_VISUAL_FILES = [
  'assets/puffer.webp', 'assets/puffer-180.png', 'assets/puffer-192.png', 'assets/puffer-512.png',
  'assets/puffer-page-days.webp', 'assets/puffer-page-things.webp', 'assets/puffer-page-us.webp',
  'assets/puffer-state-happy.webp', 'assets/puffer-state-quiet.webp',
  'assets/puffer-reaction-hydration-v1.png', 'assets/puffer-reaction-message-v1.png',
  'assets/puffer-reaction-todo-v1.png',
  'assets/hydration-water-cup-empty.webp', 'assets/hydration-drink-cup-empty.webp',
  'assets/weather-sunny-pet.webp', 'assets/weather-cloud-pet.webp',
  'assets/weather-rain-pet.webp', 'assets/weather-snow-pet.webp'
];
const CRITICAL_CACHE_URLS = [
  '/index.html',
  versionedPath('/site.webmanifest'),
  ...CRITICAL_SHELL_FILES.map(file => versionedPath(`/${file}`))
];
const WARM_VISUAL_URLS = WARM_VISUAL_FILES.map(file => versionedPath(`/${file}`));
const WARM_FONT_URLS = FONT_ASSET_FILES.map(file => versionedPath(`/assets/fonts/${file}`));
let optionalWarmPromise = null;

function cacheRequest(path) {
  return new Request(new URL(path, self.location.origin), { cache: 'reload' });
}

async function warmCacheRequest(cache, path) {
  const request = cacheRequest(path);
  if (await cache.match(request)) return 'cached';
  try {
    const response = await fetchWithTimeout(request);
    if (!response.ok) return 'failed';
    await cache.put(request, response.clone());
    return 'stored';
  } catch (_) {
    return 'failed';
  }
}

async function warmCacheGroup(cache, paths) {
  const summary = { cached: 0, stored: 0, failed: 0 };
  for (let index = 0; index < paths.length; index += WARM_CACHE_BATCH_SIZE) {
    const batch = paths.slice(index, index + WARM_CACHE_BATCH_SIZE);
    const results = await Promise.all(batch.map(path => warmCacheRequest(cache, path)));
    results.forEach(result => { summary[result] += 1; });
  }
  return summary;
}

function warmOptionalCaches() {
  if (optionalWarmPromise) return optionalWarmPromise;
  optionalWarmPromise = (async () => {
    const cache = await caches.open(CACHE_NAME);
    // 先补齐首屏图片，再分批补字体；任一非关键文件失败都不会阻塞其他文件。
    const visuals = await warmCacheGroup(cache, WARM_VISUAL_URLS);
    const fonts = await warmCacheGroup(cache, WARM_FONT_URLS);
    return { visuals, fonts };
  })().finally(() => { optionalWarmPromise = null; });
  return optionalWarmPromise;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const requests = CRITICAL_CACHE_URLS.map(cacheRequest);
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const current = new Set([CACHE_NAME, RUNTIME_CACHE_NAME]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && !current.has(key)).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'puffer-warm-cache') return;
  event.waitUntil(warmOptionalCaches().catch(() => undefined));
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
  url.searchParams.set('v', STATIC_ASSET_VERSION);
  return new Request(url.href, request);
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CORE_TIMEOUT_MS);
  try {
    return await fetch(new Request(request, { cache: 'no-store', signal: controller.signal }));
  } finally {
    clearTimeout(timeout);
  }
}

async function storeResponse(cacheName, request, response) {
  if (!response || !response.ok) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

function fetchStaticAsset(event, request) {
  const versioned = versionedAssetRequest(request);
  const update = fetchWithTimeout(versioned).then(async response => {
    await storeResponse(CACHE_NAME, versioned, response);
    return response;
  });
  event.waitUntil(update.catch(() => undefined));
  return (async () => {
    const cached = await caches.match(versioned);
    if (cached) return cached;
    try {
      return await update;
    } catch (_) {
      return (await caches.match(request)) || Response.error();
    }
  })();
}

async function fetchFresh(request, fallback = true) {
  const cached = fallback ? await caches.match(request) : null;
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok && new URL(request.url).pathname !== '/version.json') {
      const cacheName = request.mode === 'navigate' ? RUNTIME_CACHE_NAME : CACHE_NAME;
      await storeResponse(cacheName, request, response);
    }
    if (!response.ok && cached) return cached;
    return response;
  } catch (_) {
    if (cached) return cached;
    if (request.mode === 'navigate') return (await caches.match('/index.html')) || Response.error();
    return Response.error();
  }
}

function staleWhileRevalidate(event, request) {
  const update = fetch(request).then(async response => {
    await storeResponse(RUNTIME_CACHE_NAME, request, response);
    return response;
  });
  event.waitUntil(update.catch(() => undefined));
  return (async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      return await update;
    } catch (_) {
      return Response.error();
    }
  })();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;
  if (isStaticAsset(request)) {
    event.respondWith(fetchStaticAsset(event, request));
    return;
  }
  if (request.mode === 'navigate' || isAlwaysFresh(request)) {
    event.respondWith(fetchFresh(request, new URL(request.url).pathname !== '/version.json'));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, request));
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

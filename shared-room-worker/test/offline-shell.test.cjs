const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');
const origin = 'https://20051011.xyz';
const serviceWorkerSource = readFileSync(resolve(projectRoot, 'service-worker.js'), 'utf8');
const lifeSource = readFileSync(resolve(projectRoot, 'life.js'), 'utf8');

function requestKey(input) {
  if (typeof input === 'string') return new URL(input, origin).href;
  return input.url;
}

function createServiceWorkerHarness(initialCacheNames = []) {
  const handlers = {};
  const stores = new Map(initialCacheNames.map(name => [name, new Map()]));
  const deleted = [];
  const precached = [];
  const networkRequests = [];
  let claimed = 0;
  let skipped = 0;
  let fetchImpl = async request => new Response('network:' + request.url, { status: 200 });

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) {
          for (const request of requests) {
            const key = requestKey(request);
            precached.push(key);
            store.set(key, new Response('precache:' + key, { status: 200 }));
          }
        },
        async put(request, response) {
          store.set(requestKey(request), response.clone());
        }
      };
    },
    async match(request) {
      const key = requestKey(request);
      for (const store of stores.values()) {
        const response = store.get(key);
        if (response) return response.clone();
      }
      return undefined;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) {
      deleted.push(name);
      return stores.delete(name);
    }
  };

  const clients = [];
  const self = {
    location: { origin },
    addEventListener(type, handler) { handlers[type] = handler; },
    async skipWaiting() { skipped += 1; },
    clients: {
      async claim() { claimed += 1; },
      async matchAll() { return clients; },
      async openWindow() { return null; }
    },
    registration: { async showNotification() {} }
  };
  const context = {
    self,
    caches,
    fetch: async request => {
      networkRequests.push(request.url || String(request));
      return fetchImpl(request);
    },
    Request,
    Response,
    URL,
    AbortController,
    Promise,
    Map,
    Set,
    Array,
    String,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(serviceWorkerSource, context);
  return {
    handlers,
    stores,
    deleted,
    precached,
    networkRequests,
    clients,
    claimed: () => claimed,
    skipped: () => skipped,
    setFetch(next) { fetchImpl = next; }
  };
}

async function runExtendable(handler, event = {}) {
  const pending = [];
  handler({ ...event, waitUntil(value) { pending.push(Promise.resolve(value)); } });
  await Promise.all(pending);
}

async function runFetch(handler, request) {
  const pending = [];
  let responsePromise = null;
  handler({
    request,
    respondWith(value) { responsePromise = Promise.resolve(value); },
    waitUntil(value) { pending.push(Promise.resolve(value)); }
  });
  assert.ok(responsePromise, 'service worker should handle the same-origin request');
  const response = await responsePromise;
  await Promise.all(pending);
  return response;
}

test('fonts are fully local, licensed and backed by valid WOFF2 files', () => {
  const index = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const css = readFileSync(resolve(projectRoot, 'assets', 'fonts', 'fonts.css'), 'utf8');
  assert.doesNotMatch(index, /fonts\.(?:googleapis|gstatic)\.com/);
  assert.match(index, /assets\/fonts\/fonts\.css\?v=20260817-local-fonts-sw-2/);
  assert.match(css, /font-family: 'Inter'/);
  assert.match(css, /font-family: 'Noto Sans SC'/);
  assert.match(css, /font-family: 'Noto Serif SC'/);

  const fontFiles = [...new Set([...css.matchAll(/url\('\.\/([^']+\.woff2)'\)/g)].map(match => match[1]))];
  assert.equal(fontFiles.length, 29);
  fontFiles.forEach(file => {
    const path = resolve(projectRoot, 'assets', 'fonts', file);
    assert.equal(existsSync(path), true, `missing local font: ${file}`);
    assert.equal(readFileSync(path).subarray(0, 4).toString('ascii'), 'wOF2', `invalid WOFF2: ${file}`);
  });
  assert.equal(existsSync(resolve(projectRoot, 'assets', 'fonts', 'LICENSE-NOTO.txt')), true);
  assert.equal(existsSync(resolve(projectRoot, 'assets', 'fonts', 'LICENSE-INTER.txt')), true);
});

test('page, version endpoint and service worker use one release identifier', () => {
  const index = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  const version = JSON.parse(readFileSync(resolve(projectRoot, 'version.json'), 'utf8')).version;
  assert.equal(version, '20260817-local-fonts-sw-2');
  assert.match(index, new RegExp(`const pageVersion = '${version}'`));
  assert.match(serviceWorkerSource, new RegExp(`const STATIC_ASSET_VERSION = '${version}'`));
  assert.match(index, /nextUrl\.searchParams\.set\('v', remote\.version\)/);
  assert.doesNotMatch(index, /20260814-static-assets-1/);
});

test('install precaches a complete local shell before taking control', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);

  assert.equal(worker.skipped(), 1);
  assert.ok(worker.precached.length > 50);
  assert.ok(worker.precached.some(url => url.endsWith('/index.html')));
  assert.ok(worker.precached.some(url => url.includes('/assets/fonts/fonts.css?v=20260817-local-fonts-sw-2')));
  assert.ok(worker.precached.some(url => url.includes('/assets/fonts/noto-sans-sc-ui-14.woff2?v=20260817-local-fonts-sw-2')));
  assert.ok(worker.precached.some(url => url.includes('/assets/fonts/noto-serif-sc-ui-14.woff2?v=20260817-local-fonts-sw-2')));

  worker.precached.forEach(urlValue => {
    const url = new URL(urlValue);
    const file = resolve(projectRoot, decodeURIComponent(url.pathname).replace(/^\//, ''));
    assert.equal(existsSync(file), true, `precache path does not exist: ${url.pathname}`);
  });
});

test('activate removes only stale Puffer caches and preserves unrelated caches', async () => {
  const worker = createServiceWorkerHarness([
    'puffer-shell-v13-static-assets',
    'puffer-shell-v15-review-marker',
    'puffer-runtime-v15-review-marker',
    'third-party-cache'
  ]);
  await runExtendable(worker.handlers.activate);

  assert.deepEqual(worker.deleted, ['puffer-shell-v13-static-assets']);
  assert.equal(worker.stores.has('third-party-cache'), true);
  assert.equal(worker.claimed(), 1);
});

test('offline navigation and unversioned font requests fall back to the precached shell', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);
  worker.setFetch(async () => { throw new Error('offline'); });

  const navigation = new Request(origin + '/?pwa=1');
  Object.defineProperty(navigation, 'mode', { value: 'navigate' });
  const page = await runFetch(worker.handlers.fetch, navigation);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /precache:https:\/\/20051011\.xyz\/index\.html/);

  const font = await runFetch(worker.handlers.fetch, new Request(origin + '/assets/fonts/inter-ui.woff2'));
  assert.equal(font.status, 200);
  assert.match(await font.text(), /inter-ui\.woff2\?v=20260817-local-fonts-sw-2/);
});

test('saving a review writes the exact marker checked by future renders', () => {
  assert.match(lifeSource, /data-life-review-save="\$\{range\.id\}"/);
  assert.doesNotMatch(lifeSource, /data-life-review-save="\$\{type\}:\$\{range\.id\}"/);
  assert.match(lifeSource, /puffer-review-seen:\$\{reviewRange\(type\)\.id\}/);
  assert.match(lifeSource, /puffer-review-seen:\$\{saved\.dataset\.lifeReviewSave\}/);
});

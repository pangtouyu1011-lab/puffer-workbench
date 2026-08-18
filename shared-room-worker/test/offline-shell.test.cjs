const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');
const origin = 'https://20051011.xyz';
const serviceWorkerSource = readFileSync(resolve(projectRoot, 'service-worker.js'), 'utf8');
const lifeSource = readFileSync(resolve(projectRoot, 'life.js'), 'utf8');
const lifeCss = readFileSync(resolve(projectRoot, 'life.css'), 'utf8');
const lifeDashboardCss = readFileSync(resolve(projectRoot, 'life-dashboard.css'), 'utf8');
const lifeCompleteSource = readFileSync(resolve(projectRoot, 'life-complete-state.js'), 'utf8');
const lifeCompleteCss = readFileSync(resolve(projectRoot, 'life-complete-state.css'), 'utf8');
const releaseVersion = JSON.parse(readFileSync(resolve(projectRoot, 'version.json'), 'utf8')).version;
const shellCacheName = serviceWorkerSource.match(/const CACHE_NAME = '([^']+)'/)?.[1];
const runtimeCacheName = serviceWorkerSource.match(/const RUNTIME_CACHE_NAME = '([^']+)'/)?.[1];

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
        },
        async match(request) {
          const response = store.get(requestKey(request));
          return response ? response.clone() : undefined;
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
    setFetch(next) { fetchImpl = next; },
    clearNetworkRequests() { networkRequests.length = 0; }
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
  assert.ok(index.includes(`assets/fonts/fonts.css?v=${releaseVersion}`));
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
  assert.match(releaseVersion, /^\d{8}-[a-z0-9.-]+$/i);
  assert.match(index, new RegExp(`const pageVersion = '${releaseVersion}'`));
  assert.match(serviceWorkerSource, new RegExp(`const STATIC_ASSET_VERSION = '${releaseVersion}'`));
  assert.match(index, /nextUrl\.searchParams\.set\('v', remote\.version\)/);
  assert.doesNotMatch(index, /20260814-static-assets-1/);
});

test('install caches only the critical shell before taking control', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);

  assert.equal(worker.skipped(), 1);
  assert.ok(worker.precached.length >= 20 && worker.precached.length < 40);
  assert.ok(worker.precached.some(url => url.endsWith('/index.html')));
  assert.ok(worker.precached.some(url => url.includes(`/assets/fonts/fonts.css?v=${releaseVersion}`)));
  assert.ok(worker.precached.some(url => url.includes(`/app.js?v=${releaseVersion}`)));
  assert.ok(!worker.precached.some(url => url.includes('/assets/puffer-page-days.webp')));
  assert.ok(!worker.precached.some(url => url.includes('/assets/fonts/noto-sans-sc-ui-14.woff2')));

  worker.precached.forEach(urlValue => {
    const url = new URL(urlValue);
    const file = resolve(projectRoot, decodeURIComponent(url.pathname).replace(/^\//, ''));
    assert.equal(existsSync(file), true, `precache path does not exist: ${url.pathname}`);
  });
});

test('idle warm-up caches visuals before fonts and shares one in-flight run', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);
  const message = { data: { type: 'puffer-warm-cache' } };
  await Promise.all([
    runExtendable(worker.handlers.message, message),
    runExtendable(worker.handlers.message, message)
  ]);

  assert.equal(worker.networkRequests.length, 47);
  const firstFont = worker.networkRequests.findIndex(url => url.includes('/assets/fonts/inter-ui.woff2'));
  const lastVisual = worker.networkRequests.findLastIndex(url => url.includes('.webp') || url.includes('puffer-180.png') || url.includes('puffer-192.png') || url.includes('puffer-512.png'));
  assert.ok(firstFont > lastVisual, 'visual warm-up should complete before font warm-up starts');
  assert.ok(worker.networkRequests.some(url => url.includes(`/assets/puffer-page-days.webp?v=${releaseVersion}`)));
  assert.ok(worker.networkRequests.some(url => url.includes(`/assets/fonts/noto-serif-sc-ui-14.woff2?v=${releaseVersion}`)));
});

test('one failed optional asset does not block the rest and only the missing file retries', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);
  const failedName = 'noto-sans-sc-ui-07.woff2';
  worker.setFetch(async request => request.url.includes(failedName)
    ? new Response('temporary failure', { status: 503 })
    : new Response('network:' + request.url, { status: 200 }));
  await runExtendable(worker.handlers.message, { data: { type: 'puffer-warm-cache' } });

  const shell = worker.stores.get(shellCacheName);
  assert.equal([...shell.keys()].some(url => url.includes(failedName)), false);
  assert.equal([...shell.keys()].some(url => url.includes('noto-sans-sc-ui-08.woff2')), true);
  assert.equal([...shell.keys()].some(url => url.includes('noto-serif-sc-ui-14.woff2')), true);

  worker.clearNetworkRequests();
  worker.setFetch(async request => new Response('retry:' + request.url, { status: 200 }));
  await runExtendable(worker.handlers.message, { data: { type: 'puffer-warm-cache' } });
  assert.equal(worker.networkRequests.length, 1);
  assert.match(worker.networkRequests[0], new RegExp(failedName));
});

test('page requests optional cache warming only after the worker is ready or replaced', () => {
  const index = readFileSync(resolve(projectRoot, 'index.html'), 'utf8');
  assert.match(index, /requestIdleCallback/);
  assert.match(index, /postMessage\(\{ type: 'puffer-warm-cache' \}\)/);
  assert.match(index, /serviceWorker\.ready\.then\(warmCache\)/);
  assert.match(index, /addEventListener\('controllerchange'/);
});

test('activate removes only stale Puffer caches and preserves unrelated caches', async () => {
  const worker = createServiceWorkerHarness([
    'puffer-shell-v13-static-assets',
    shellCacheName,
    runtimeCacheName,
    'third-party-cache'
  ]);
  await runExtendable(worker.handlers.activate);

  assert.deepEqual(worker.deleted, ['puffer-shell-v13-static-assets']);
  assert.equal(worker.stores.has('third-party-cache'), true);
  assert.equal(worker.claimed(), 1);
});

test('critical shell works offline before optional warm-up', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);
  worker.setFetch(async () => { throw new Error('offline'); });

  const navigation = new Request(origin + '/?pwa=1');
  Object.defineProperty(navigation, 'mode', { value: 'navigate' });
  const page = await runFetch(worker.handlers.fetch, navigation);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /precache:https:\/\/20051011\.xyz\/index\.html/);

  const css = await runFetch(worker.handlers.fetch, new Request(`${origin}/styles.css?v=${releaseVersion}`));
  assert.equal(css.status, 200);
  assert.match(await css.text(), /precache:https:\/\/20051011\.xyz\/styles\.css/);
});

test('warmed optional fonts remain available offline through the versioned fallback', async () => {
  const worker = createServiceWorkerHarness();
  await runExtendable(worker.handlers.install);
  await runExtendable(worker.handlers.message, { data: { type: 'puffer-warm-cache' } });
  worker.setFetch(async () => { throw new Error('offline'); });

  const font = await runFetch(worker.handlers.fetch, new Request(origin + '/assets/fonts/inter-ui.woff2'));
  assert.equal(font.status, 200);
  assert.ok((await font.text()).includes(`inter-ui.woff2?v=${releaseVersion}`));
});

test('saving a review writes the exact marker checked by future renders', () => {
  assert.match(lifeSource, /data-life-review-save="\$\{range\.id\}"/);
  assert.doesNotMatch(lifeSource, /data-life-review-save="\$\{type\}:\$\{range\.id\}"/);
  assert.match(lifeSource, /puffer-review-seen:\$\{reviewRange\(type\)\.id\}/);
  assert.match(lifeSource, /puffer-review-seen:\$\{saved\.dataset\.lifeReviewSave\}/);
});

test('automatic reviews open once per day and the floating puffer reopens them', () => {
  const start = lifeSource.indexOf('  function maybeOfferReview()');
  const end = lifeSource.indexOf("  root.addEventListener('click', e =>", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const automaticOffer = lifeSource.slice(start, end);
  assert.match(automaticOffer, /localStorage\.setItem\(freshMarker\.key,freshMarker\.value\);[\s\S]*reviewSheet\(freshType\)/);
  assert.match(lifeSource, /puffer-review-auto-shown:\$\{me\}/);
  assert.match(lifeSource, /value:`\$\{dayKey\(\)\}:\$\{type\}`/);
  assert.match(lifeSource, /function openCompanionOrReview\(\).*type\?reviewSheet\(type\):companionResponseSheet\(\)/);
  assert.match(lifeSource, /#lifeCompanionFloat'\)\) return openCompanionOrReview\(\)/);
  assert.match(lifeSource, /document\.hidden\|\|activeLifeTab!=='today'\|\|mask\.classList\.contains\('show'\)/);
  assert.match(lifeSource, /!liveMessageNotice\.hidden&&liveMessageNotice\.classList\.contains\('show'\)/);
  assert.doesNotMatch(lifeSource, /lifeReviewNotice|data-life-review-(?:open|dismiss)/);
  assert.doesNotMatch(lifeCss, /\.life-review-notice\{/);
});

test('Life message receipts update in place and stay single-line on narrow screens', () => {
  assert.match(lifeSource, /data-message-receipt/);
  assert.match(lifeSource, /puffer-sync-status/);
  assert.match(lifeSource, /data-sync-retry/);
  assert.match(lifeCss, /\.life-message-meta\{[^}]*min-width:0/);
  assert.match(lifeCss, /\.life-message-meta time\{[^}]*text-overflow:ellipsis;white-space:nowrap/);
  assert.match(lifeCss, /\.life-message-receipt\{[^}]*flex:0 0 auto;[^}]*white-space:nowrap/);
});

test('Life data forms share one busy lock without changing button text width', () => {
  assert.match(lifeSource, /const lifeSubmitSelector = '[^']*data-save-travel[^']*data-save-message[^']*data-save-photo[^']*data-save-wish/);
  assert.match(lifeSource, /lifeSubmissionLocks\.has\(key\)/);
  assert.match(lifeSource, /button\.disabled=true/);
  assert.match(lifeSource, /button\.setAttribute\('aria-busy','true'\)/);
  assert.match(lifeCss, /button\.is-submitting::after/);
  assert.doesNotMatch(lifeSource, /button\.textContent=['"](?:保存中|提交中|处理中)/);
});

test('floating companion separates taps from drags and keeps one stable pet-anchored nudge', () => {
  assert.match(lifeSource, /Math\.hypot\(dx,dy\)<7/);
  assert.match(lifeSource, /_suppressClickUntil=performance\.now\(\)\+300/);
  assert.match(lifeSource, /performance\.now\(\)<\(node\._suppressClickUntil\|\|0\)/);
  assert.match(lifeSource, /const leftCandidate=r\.left-w-gap,rightCandidate=r\.right\+gap/);
  assert.match(lifeSource, /const petOnRight=r\.left\+r\.width\/2>/);
  assert.doesNotMatch(lifeSource, /window\.addEventListener\('scroll', queueCompanionNudgePosition/);
  assert.doesNotMatch(lifeSource, /visualViewport\?\.addEventListener\('scroll', queueCompanionNudgePosition/);
  assert.match(lifeSource, /if\(mask\.classList\.contains\('show'\)\)return removeCompanionNudge\(\)/);
  assert.match(lifeSource, /puffer-companion-nudge-shown:\$\{dayKey\(\)\}/);
  assert.match(lifeSource, /node\._hideTimer=setTimeout\([\s\S]*?,4000\)/);
});

test('Life input sheets follow VisualViewport and keep a single keyboard-safe save action', () => {
  assert.match(lifeSource, /window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(lifeSource, /keyboardDelta > 96/);
  assert.match(lifeSource, /sheetKeyboardActionSelector = '[^']*data-save-message[^']*data-save-wish[^']*data-save-training[^']*data-save-travel/);
  assert.match(lifeSource, /sheetKeyboardRestore\.container\.scrollTop = sheetKeyboardRestore\.scrollTop/);
  assert.match(lifeCss, /\.life-sheet-mask\.is-keyboard-open \.life-sheet-body\{/);
  assert.match(lifeCss, /\.life-keyboard-dock\{[^}]*position:absolute/);
  assert.match(lifeCss, /\.life-keyboard-dock \.life-keyboard-action\{[^}]*width:100%/);
});

test('P2 companion reactions wait for room sync and never celebrate a failed save', () => {
  assert.match(lifeSource, /requestCompanionReaction\('hydration'\)/);
  assert.match(lifeSource, /requestCompanionReaction\('message'\)/);
  assert.match(lifeSource, /if\(ok&&!wasDone\)requestCompanionReaction\('todo'\)/);
  assert.match(lifeSource, /hydration:\{asset:'puffer-reaction-hydration-v1\.png'/);
  assert.match(lifeSource, /message:\{asset:'puffer-reaction-message-v1\.png'/);
  assert.match(lifeSource, /todo:\{asset:'puffer-reaction-todo-v1\.png'/);
  assert.match(serviceWorkerSource, /assets\/puffer-reaction-hydration-v1\.png/);
  assert.match(serviceWorkerSource, /assets\/puffer-reaction-message-v1\.png/);
  assert.match(serviceWorkerSource, /assets\/puffer-reaction-todo-v1\.png/);
  assert.match(lifeSource, /if\(sync\.failed\|\|sync\.key==='failed'\)return false/);
  assert.match(lifeSource, /status\.failed\|\|status\.key==='failed'[\s\S]*clearPendingCompanionReaction\(\)/);
  assert.match(lifeSource, /status\.key!=='synced'\|\|status\.pending\|\|status\.busy/);
  assert.match(lifeSource, /node\._reactionTimer=setTimeout\([\s\S]*?,900\)/);
  assert.match(lifeCss, /life-companion-action-reaction \.78s/);
  assert.doesNotMatch(lifeSource, /puffer-companion-celebration-/);
});

test('P2 completed content becomes quiet without replacing its actions', () => {
  assert.match(lifeCompleteSource, /card\.classList\.toggle\('life-together-complete', done\)/);
  assert.match(lifeCompleteSource, /challenge\.insertAdjacentElement\('afterend', summary\)/);
  assert.doesNotMatch(lifeCompleteSource, /card\.innerHTML\s*=/);
  assert.match(lifeSource, /life-home-todo \$\{t\.done\?'is-complete':''\}/);
  assert.match(lifeSource, /aria-pressed="\$\{t\.done\?'true':'false'\}"/);
  assert.match(lifeSource, /life-row \$\{t\.done\?'is-complete':''\}/);
  assert.match(lifeDashboardCss, /\.life-home-todo\.is-complete\{/);
  assert.match(lifeCss, /\.life-row\.is-complete\{/);
  assert.match(lifeCompleteCss, /\.life-together-card\.life-together-complete\{/);
  assert.doesNotMatch(lifeCompleteCss, /infinite/);
});

test('P3 time atmosphere changes tone without changing page structure', () => {
  assert.match(lifeSource, /function lifeTimePhase\(hour = new Date\(\)\.getHours\(\)\)/);
  assert.match(lifeSource, /hour >= 5 && hour < 11[\s\S]*return 'morning'/);
  assert.match(lifeSource, /hour >= 11 && hour < 18[\s\S]*return 'day'/);
  assert.match(lifeSource, /hour >= 18 && hour < 20[\s\S]*return 'evening'/);
  assert.match(lifeSource, /document\.body\.dataset\.lifeTime = phase/);
  assert.match(lifeSource, /setInterval\(\(\) => \{ if\(!document\.hidden&&syncTimeAtmosphere\(\)\)render\(\); \}, 60000\)/);
  assert.match(lifeSource, /phase==='morning'[\s\S]*puffer-state-happy\.webp[\s\S]*tone:'morning'/);
  assert.match(lifeSource, /phase==='evening'[\s\S]*puffer-state-missing\.webp[\s\S]*tone:'evening'/);
  ['morning','day','evening','night'].forEach(phase => {
    assert.match(lifeCss, new RegExp(`body\\.life-mode\\[data-life-time="${phase}"\\]\\{`));
  });
  assert.match(lifeCss, /\.life-card\{background:linear-gradient\(145deg,var\(--life-time-card-a\),var\(--life-time-card-b\)\)!important/);
  assert.match(lifeCss, /\.life-nav\{background:var\(--life-time-nav\)!important/);
  assert.doesNotMatch(lifeCss, /data-life-time[^\{]*\{[^\}]*(?:position|width|height|padding|margin):/);
});

test('floating bottom navigation stays iPhone-safe and exposes one current page', () => {
  assert.match(lifeSource, /type="button"[^>]*data-life-tab="\$\{page\}"[^>]*aria-label=/);
  assert.match(lifeSource, /if \(active\) node\.setAttribute\('aria-current', 'page'\); else node\.removeAttribute\('aria-current'\)/);
  assert.match(lifeCss, /bottom:max\(8px,env\(safe-area-inset-bottom\)\)/);
  assert.match(lifeCss, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(lifeCss, /width:calc\(min\(100%,430px\) - 32px\)/);
  assert.match(lifeCss, /min-height:50px/);
  assert.match(lifeCss, /font:600 10px\/14px var\(--font-body\)/);
  assert.match(lifeCss, /\.life-nav button>span\{[^}]*font-size:10px/);
  assert.match(lifeCss, /\.life-nav button\.active\{background:var\(--life-nav-active\)/);
  assert.match(lifeCss, /\.life-nav button:focus-visible\{outline:/);
  assert.match(lifeCss, /@media\(prefers-reduced-motion:reduce\)\{\.life-nav button,\.life-nav button>i\{transition:none\}/);
});

test('P1 Bottom Sheets share one 210ms close path and honor reduced motion', () => {
  assert.match(lifeSource, /mask\.classList\.add\('is-closing'\)/);
  assert.match(lifeSource, /const duration=window\.matchMedia\?\.\('\(prefers-reduced-motion: reduce\)'\)\.matches\?0:210/);
  assert.match(lifeSource, /if\(duration\)sheetCloseTimer=setTimeout\(finishClose,duration\);else finishClose\(\)/);
  assert.match(lifeSource, /closeSheet\(false, true\)/);
  assert.match(lifeSource, /if \(mask\.classList\.contains\('show'\)\) return closeSheet\(true\)/);
  assert.match(lifeSource, /reopeningAfterHistoryClose = sheetClosing && sheetClosingFromHistory/);
  assert.match(lifeCss, /\.life-sheet-mask\{[^}]*visibility:hidden;opacity:0;pointer-events:none[^}]*transition:opacity 200ms ease,visibility 0s linear 210ms/);
  assert.match(lifeCss, /\.life-sheet\{[^}]*transform:translate3d\(0,100%,0\)[^}]*transform 210ms/);
  assert.match(lifeCss, /@media\(prefers-reduced-motion:reduce\)\{\.life-sheet-mask,\.life-sheet\{transition:none!important\}/);
  assert.match(lifeCss, /\.life-sheet-mask\.is-closing\{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important\}/);
  assert.match(lifeCss, /\.life-sheet-mask\{background:rgba\(24,28,36,\.3\)!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important\}/);
  assert.match(lifeCss, /\.life-sheet-mask>\.life-sheet\{position:relative;z-index:1;visibility:visible;isolation:isolate/);
  assert.doesNotMatch(lifeSource, /setTimeout\(closeSheet,\s*180\)/);
});

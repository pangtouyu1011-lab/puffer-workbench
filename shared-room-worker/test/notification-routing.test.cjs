const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');

function loadPushChanges() {
  const source = readFileSync(resolve(__dirname, '..', 'worker.js'), 'utf8');
  const start = source.indexOf('function pushChanges(');
  const end = source.indexOf('\nasync function sendRoomPushes', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}; this.pushChanges = pushChanges;`, context);
  return context.pushChanges;
}

function loadServiceWorker() {
  const handlers = {};
  const shown = [];
  const clients = [];
  const opened = [];
  const self = {
    location: { origin: 'https://20051011.xyz' },
    addEventListener(type, handler) { handlers[type] = handler; },
    skipWaiting: async () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => clients,
      openWindow: async target => { opened.push(target); return null; }
    },
    registration: {
      showNotification: async (title, options) => { shown.push({ title, options }); }
    }
  };
  const context = {
    self,
    caches: { keys: async () => [], delete: async () => true, match: async () => null, open: async () => ({ put: async () => {} }) },
    fetch: async () => new Response('ok'),
    Request,
    Response,
    URL,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(projectRoot, 'service-worker.js'), 'utf8'), context);
  return { handlers, shown, clients, opened };
}

async function runExtendable(handler, event) {
  let pending = Promise.resolve();
  handler({ ...event, waitUntil(value) { pending = Promise.resolve(value); } });
  await pending;
}

test('new todos carry an author and old clients still produce a routed push change', () => {
  const app = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');
  assert.match(app, /state\.todos\.push\(\{ id: uid\(\), author: state\.settings\.me \|\| 'a'/);
  const pushChanges = loadPushChanges();
  const createdAt = Date.now();
  const change = pushChanges({ todos: [] }, { todos: [{ id: 'todo-1', text: '买水果', createdAt }] }, 'a');
  assert.equal(change.kind, 'todos');
  assert.equal(change.recordId, 'todo-1');
  assert.equal(change.tag, 'puffer-todos-todo-1');
  assert.equal(change.url, 'https://20051011.xyz/?open=todo');
});

test('foreground Web Push does not create a second page-level system notification', () => {
  const app = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');
  assert.match(app, /localStorage\.getItem\('puffer-push-enabled'\) !== '1'/);
  assert.match(app, /tag: `puffer-messages-\$\{m\.id\}`/);
});

test('notification click routes an existing client to the matching feature', async () => {
  const worker = loadServiceWorker();
  const messages = [];
  worker.clients.push({ postMessage(value) { messages.push(value); }, focus: async () => {} });
  await runExtendable(worker.handlers.notificationclick, {
    notification: { close() {}, data: { url: 'https://20051011.xyz/?open=messages', kind: 'messages' } }
  });
  assert.equal(JSON.stringify(messages), JSON.stringify([{ type: 'puffer-open-notification', kind: 'messages' }]));
  assert.deepEqual(worker.opened, []);
});

test('notification click cold-starts the exact routed URL', async () => {
  const worker = loadServiceWorker();
  await runExtendable(worker.handlers.notificationclick, {
    notification: { close() {}, data: { url: 'https://20051011.xyz/?open=gallery', kind: 'gallery' } }
  });
  assert.deepEqual(worker.opened, ['https://20051011.xyz/?open=gallery']);
});

test('hydration reminder cold-starts the hydration recorder', async () => {
  const worker = loadServiceWorker();
  await runExtendable(worker.handlers.notificationclick, {
    notification: { close() {}, data: { url: 'https://20051011.xyz/?open=hydration', kind: 'hydration' } }
  });
  assert.deepEqual(worker.opened, ['https://20051011.xyz/?open=hydration']);
});

test('hydration records merge by id and do not reuse the legacy maximum counter', () => {
  const app = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');
  assert.match(app, /hydrationLog: mergeArr\(local\.hydrationLog, remote\.hydrationLog\)/);
  assert.match(app, /state\.hydrationLog\.push\(\{ id: uid\(\), author:/);
  assert.match(app, /WATER_GOAL_ML = 1500/);
});

test('scheduled hydration reminder keeps its routed kind and URL', () => {
  const source = readFileSync(resolve(__dirname, '..', 'worker.js'), 'utf8');
  assert.match(source, /hour === 15 && minute === 30\) return 'hydration'/);
  assert.match(source, /kind: reminder\.kind \|\| 'reminder'/);
  assert.match(source, /url: reminder\.url \|\| 'https:\/\/20051011\.xyz\/'/);
});

test('scheduled reminders claim their D1 slot before building a push payload', () => {
  const source = readFileSync(resolve(__dirname, '..', 'worker.js'), 'utf8');
  const start = source.indexOf('async function scheduledPushes(');
  const end = source.indexOf('\nfunction mediaKeysInPayload', start);
  const body = source.slice(start, end);
  assert.ok(body.indexOf('INSERT OR IGNORE INTO scheduled_pushes') >= 0);
  assert.ok(body.indexOf('INSERT OR IGNORE INTO scheduled_pushes') < body.indexOf('buildPushPayload'));
  assert.match(body, /claim\?\.meta\?\.changes/);
});

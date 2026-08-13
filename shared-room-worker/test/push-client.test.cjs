const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

function loadClient({ failUnsubscribe = false } = {}) {
  const calls = [];
  const removed = [];
  let browserUnsubscribed = false;
  const pushSubscription = {
    endpoint: 'https://push.example/current-device',
    toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'key', auth: 'auth' } }; },
    async unsubscribe() { browserUnsubscribed = true; return true; }
  };
  const registration = { pushManager: { getSubscription: async () => pushSubscription } };
  const state = { settings: { me: 'a', room: { backend: 'worker', joined: true, url: 'https://sync.example', id: 'current-room', pass: 'current-pass' } } };
  const notification = { permission: 'granted', requestPermission: async () => 'granted' };
  const pushManager = function PushManager() {};
  const browserWindow = { PufferLife: { getState: () => state }, Notification: notification, PushManager: pushManager, dispatchEvent() {} };
  const context = {
    window: browserWindow,
    navigator: { serviceWorker: { getRegistration: async () => registration, register: async () => registration } },
    Notification: notification,
    PushManager: pushManager,
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem(key) { removed.push(key); }
    },
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), body, method: init.method || 'GET' });
      if (String(url).endsWith('/push/unsubscribe') && failUnsubscribe) throw new Error('offline');
      if (String(url).endsWith('/push/status')) return { ok: true, json: async () => ({ subscribed: true }) };
      return { ok: true, json: async () => ({ ok: true }) };
    },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    console
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(__dirname, '..', '..', 'push.js'), 'utf8'), context);
  return { api: context.window.PufferPush, calls, removed, browserUnsubscribed: () => browserUnsubscribed };
}

test('push client status asks about the current browser endpoint', async () => {
  const client = loadClient();
  const result = await client.api.status();
  assert.equal(result.subscribed, true);
  assert.equal(result.serverSubscribed, true);
  const call = client.calls.find(item => item.url.endsWith('/push/status'));
  assert.equal(call.body.endpoint, 'https://push.example/current-device');
  assert.equal(call.body.person, 'a');
});

test('push client disables the browser endpoint against the old room context', async () => {
  const client = loadClient();
  await client.api.disable({ backend: 'worker', url: 'https://old.example', id: 'old-room', pass: 'old-pass', person: 'b' });
  const call = client.calls.find(item => item.url.endsWith('/push/unsubscribe'));
  assert.equal(call.url, 'https://old.example/api/v1/rooms/old-room/push/unsubscribe');
  assert.equal(call.body.pass, 'old-pass');
  assert.equal(call.body.endpoint, 'https://push.example/current-device');
  assert.equal(client.browserUnsubscribed(), true);
  assert.deepEqual(client.removed, ['puffer-push-enabled', 'puffer-push-endpoint']);
});

test('push client still invalidates the browser endpoint when server cleanup is offline', async () => {
  const client = loadClient({ failUnsubscribe: true });
  await assert.rejects(client.api.disable({ url: 'https://old.example', id: 'old-room', pass: 'old-pass', person: 'a' }), error => {
    assert.equal(error.endpoint, 'https://push.example/current-device');
    return true;
  });
  assert.equal(client.browserUnsubscribed(), true);
});

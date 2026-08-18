const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');
const appSource = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');
const lifeSource = readFileSync(resolve(projectRoot, 'life.js'), 'utf8');
const lifeCssSource = readFileSync(resolve(projectRoot, 'life.css'), 'utf8');

function sourceSection(startMarker, endMarker, from = 0) {
  const start = appSource.indexOf(startMarker, from);
  assert.notEqual(start, -1, `missing app.js marker: ${startMarker}`);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing app.js marker: ${endMarker}`);
  return appSource.slice(start, end);
}

function loadRoomSyncCore() {
  const serialization = sourceSection(
    '  const ROOM_TOMBSTONE_RETENTION_MS',
    '  // 同一时间戳的极少数并发编辑'
  );
  const merging = sourceSection(
    '  function stableRecord',
    '  // 移动网络偶发 DNS / IPv6 / TLS 路由卡住时'
  );
  const context = { Date, JSON, Map, Set, Object, Number, Array, String, Math };
  vm.createContext(context);
  vm.runInContext(`
    let state = {};
    function dedupeMeals() {}
    function normWater(value) {
      if (typeof value === 'number') return { a: value, b: 0 };
      return { a: Number(value && value.a) || 0, b: Number(value && value.b) || 0 };
    }
    function migrateLegacyWater() {}
    function todayKey() { return '2026-08-17'; }
    ${serialization}
    ${merging}
    this.roomSyncCore = {
      serialize(nextState) {
        state = nextState;
        return serializeRoom();
      },
      merge(local, remote) {
        state = local;
        mergeState(local, remote);
        return local;
      },
      mergeArr
    };
  `, context);
  return context.roomSyncCore;
}

function loadSyncReceiptCore() {
  const receiptState = sourceSection(
    '  function ensureRoomSyncMeta',
    '  function emitSyncStatus'
  );
  const context = { Date, JSON, Set, Object, Number, Array, String, Math };
  vm.createContext(context);
  vm.runInContext(`
    const DEFAULT_WORKER_URL = 'https://sync.example.test';
    let state = { settings: { room: { joined: false, pendingSyncAt: 0, pendingMessageIds: [], lastPushError: '', lastError: '', lastSync: 0 } } };
    let syncBusy = false;
    let syncFailed = false;
    ${receiptState}
    this.syncReceiptCore = {
      reset(room) { state = { settings: { room: { lastSync: 0, lastError: '', lastPushError: '', pendingSyncAt: 0, pendingMessageIds: [], ...room } } }; syncBusy = false; syncFailed = false; },
      mark(id) { markPendingMessage(id); return markPendingSync(); },
      status() { return getRoomSyncStatus(); },
      receipt(id) { return getMessageReceipt(id); },
      busy(value) { syncBusy = !!value; },
      failed(value) { syncFailed = !!value; },
      acknowledge(generation, ids) { acknowledgeRoomSnapshot(state.settings.room, generation, ids); },
      room() { return state.settings.room; }
    };
  `, context);
  return context.syncReceiptCore;
}

function loadSubmissionGate() {
  const gateSource = sourceSection(
    '  const activeSubmissionLocks',
    '  const isLifeMode'
  );
  const context = { Set, Promise };
  vm.createContext(context);
  vm.runInContext(`${gateSource}\nthis.runSubmission = runSubmission;`, context);
  return context.runSubmission;
}

function loadInputDraftCore() {
  const draftSource = sourceSection(
    "  const INPUT_DRAFT_STORAGE_KEY",
    '  const defaultPlan'
  );
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
  const context = { Date, JSON, Map, Object, Number, Array, String, console, localStorage };
  vm.createContext(context);
  vm.runInContext(`
    let state = { settings: { me: 'a', room: { joined: true, id: 'private-room' } } };
    ${draftSource}
    this.inputDraftCore = {
      get: getInputDraft,
      set: setInputDraft,
      clear: clearInputDraft,
      identity(me) { state.settings.me = me; },
      room(joined, id) { state.settings.room = { joined, id }; }
    };
  `, context);
  return { core: context.inputDraftCore, values };
}

const sync = loadRoomSyncCore();
const receipts = loadSyncReceiptCore();
const runSubmission = loadSubmissionGate();
const drafts = loadInputDraftCore();
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => clone(value);

function baseState(me) {
  return {
    todos: [], trainings: [], messages: [], gallery: [], travels: [], meals: [], wishes: [],
    water: {}, hydrationLog: [], challengeAnswers: [], dailyStatus: {}, interactionHistory: {},
    fortune: null, fitnessPlan: {}, settings: { me, partners: { a: '孙大炮', b: '童大侠' } }
  };
}

function converge(left, right) {
  // A 端先提交；B 端遇到 revision 冲突后拉取、合并并重试；A 端再拉取最终快照。
  const firstServerSnapshot = plain(sync.serialize(clone(left)));
  const rightAfterConflict = plain(sync.merge(clone(right), firstServerSnapshot));
  const finalServerSnapshot = plain(sync.serialize(clone(rightAfterConflict)));
  const leftAfterPull = plain(sync.merge(clone(left), finalServerSnapshot));
  return { left: leftAfterPull, right: rightAfterConflict, server: finalServerSnapshot };
}

function byId(items) {
  return new Map(items.map(item => [item.id, item]));
}

test('message receipts distinguish local, pending, syncing, failed and synced states', () => {
  receipts.reset({ joined: false });
  receipts.mark('message-local');
  assert.equal(receipts.receipt('message-local').key, 'local');

  receipts.reset({ joined: true });
  receipts.mark('message-pending');
  assert.equal(receipts.status().key, 'pending');
  assert.equal(receipts.receipt('message-pending').label, '待同步');

  receipts.busy(true);
  assert.equal(receipts.receipt('message-pending').key, 'syncing');
  receipts.busy(false);
  receipts.failed(true);
  assert.equal(receipts.receipt('message-pending').key, 'failed');
  assert.equal(receipts.receipt('message-pending').canRetry, true);

  receipts.failed(false);
  const generation = receipts.room().pendingSyncAt;
  receipts.acknowledge(generation, ['message-pending']);
  assert.equal(receipts.status().key, 'synced');
  assert.equal(receipts.receipt('message-pending').label, '已同步');
});

test('snapshot acknowledgement preserves messages created while an upload is in flight', () => {
  receipts.reset({ joined: true, pendingSyncAt: 10, pendingMessageIds: ['message-old'] });
  const uploadGeneration = receipts.room().pendingSyncAt;
  receipts.mark('message-new');
  receipts.acknowledge(uploadGeneration, ['message-old']);

  assert.ok(receipts.room().pendingSyncAt > uploadGeneration);
  assert.deepEqual([...receipts.room().pendingMessageIds], ['message-new']);
  assert.equal(receipts.receipt('message-old').key, 'synced');
  assert.equal(receipts.receipt('message-new').key, 'pending');
});

test('every message creation path registers a local pending receipt before saving', () => {
  const registrations = [...appSource.matchAll(/markPendingMessage\(message\.id\);\s*save\(\)/g)];
  assert.equal(registrations.length, 3);
});

test('local receipt metadata never enters the shared room snapshot', () => {
  const state = baseState('a');
  state.settings.room = {
    pendingSyncAt: Date.now(), pendingMessageIds: ['private-message-id'], lastPushError: 'offline'
  };
  const payload = plain(sync.serialize(state));
  const encoded = JSON.stringify(payload);
  assert.doesNotMatch(encoded, /pendingSyncAt|pendingMessageIds|lastPushError|private-message-id/);
});

test('submission gate ignores concurrent clicks and unlocks after completion', async () => {
  const classes = new Set();
  const attributes = new Map();
  const button = {
    dataset: {}, disabled: false,
    classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); } },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); }
  };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const task = () => { calls += 1; return pending; };

  const first = runSubmission(button, task, 'shared-key');
  const second = await runSubmission(button, task, 'shared-key');
  assert.equal(calls, 1);
  assert.equal(second, false);
  assert.equal(button.disabled, true);
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.equal(classes.has('is-submitting'), true);

  release(true);
  assert.equal(await first, true);
  assert.equal(button.disabled, false);
  assert.equal(attributes.has('aria-busy'), false);
  assert.equal(classes.has('is-submitting'), false);
});

test('manual sync reuses an in-flight request while automatic saves may queue', () => {
  assert.match(appSource, /pushToRoom\(\{ queueIfBusy: true \}\)/);
  assert.match(appSource, /if \(options\.queueIfBusy\) \{\s*pushQueued = true;/);
  assert.doesNotMatch(appSource, /if \(pushInFlight\) \{\s*pushQueued = true;/);
});

test('input drafts stay local and are isolated by person and room', () => {
  assert.equal(drafts.core.set('message', { text: '还没发送的一句话' }), true);
  assert.deepEqual(plain(drafts.core.get('message').fields), { text: '还没发送的一句话' });
  assert.equal([...drafts.values.keys()].length, 1);
  assert.equal([...drafts.values.keys()][0], 'puffer-input-drafts:v1');

  drafts.core.identity('b');
  assert.equal(drafts.core.get('message'), null);
  drafts.core.identity('a');
  assert.equal(drafts.core.get('message').fields.text, '还没发送的一句话');

  drafts.core.room(true, 'another-room');
  assert.equal(drafts.core.get('message'), null);
  drafts.core.room(true, 'private-room');
  assert.equal(drafts.core.clear('message'), true);
  assert.equal(drafts.core.get('message'), null);
});

test('Life input sheets restore text fields, flush on exit and clear only after success', () => {
  for (const scope of ['message', 'gallery', 'travel:new', 'wish']) {
    assert.match(lifeSource, new RegExp(`data-life-draft=\\"${scope.replace(':', '\\:')}`));
  }
  assert.match(lifeSource, /data-life-draft-field="text"/);
  assert.match(lifeSource, /data-life-draft-field="place"/);
  assert.match(lifeSource, /data-life-draft-field="content"/);
  assert.match(lifeSource, /data-life-draft-field="note"/);
  assert.match(lifeSource, /window\.addEventListener\('pagehide', \(\) => finishActiveSheetDraft\(true\)\)/);
  assert.ok((lifeSource.match(/if\(ok\)\{clearSheetDraft\(button\)/g) || []).length >= 8);
  assert.doesNotMatch(lifeSource, /id="life(?:MessageImage|PhotoFile|TravelPhoto)" data-life-draft-field/);
  const serialization = sourceSection('  function serializeRoom', '  function stableRecord');
  assert.doesNotMatch(serialization, /INPUT_DRAFT|inputDraft/i);
});

test('Life data forms show field-level validation, limits and persistent failure feedback', () => {
  assert.match(lifeSource, /function validateLifeSubmission\(button\)/);
  assert.match(lifeSource, /if\(!validateLifeSubmission\(button\)\)return false;/);
  for (const message of [
    '请先填写这次旅行的地点',
    '请输入 1–3000 ml 的饮用量',
    '请先写下要完成的事情',
    '请先填写今天的训练内容',
    '写一句话，或者选择一张照片再发送',
    '请先选择一张要保存的照片',
    '请先写下一个小心愿'
  ]) assert.match(lifeSource, new RegExp(message));
  for (const limit of ['160', '1200', '200', '800', '80', '240']) {
    assert.match(lifeSource, new RegExp(`maxlength=\\"${limit}\\"`));
  }
  assert.match(lifeSource, /className = 'life-field-counter'/);
  assert.match(lifeSource, /field\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(lifeSource, /catch\(error\)\{const message=lifeSubmissionError\(error\);showLifeFormFeedback/);
  assert.ok((lifeSource.match(/notifyLifeSaved\(/g) || []).length >= 8);
  assert.match(appSource, /notify\(message, type = 'success'\) \{ toast\(String\(message \|\| ''\), type\); return true; \}/);
  assert.match(lifeCssSource, /\.life-field-error\{/);
  assert.match(lifeCssSource, /\.life-form-feedback\.is-info\{/);
  assert.match(lifeCssSource, /\.is-invalid\{/);
});

test('foreground incoming messages stay visible, persist unread state and refresh an open conversation', () => {
  assert.match(appSource, /function notifyNewMessages\(messages\)/);
  assert.match(appSource, /document\.querySelector\('\.life-sheet-mask\.show \.life-chat-sheet'\)/);
  assert.match(appSource, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(state\)\)/);
  assert.match(appSource, /new CustomEvent\('puffer-new-messages'/);
  assert.match(appSource, /if \(!incomingMessages\.length\) toast\('共同空间已更新：'/);
  assert.match(appSource, /markMessagesRead\(\) \{ return markMessagesRead\(\); \}/);

  assert.match(lifeSource, /id = 'lifeLiveMessageNotice'/);
  assert.match(lifeSource, /function refreshOpenMessageSheet\(forceScroll = false\)/);
  assert.match(lifeSource, /if\(!mask\.classList\.contains\('show'\)\|\|!panel\|\|!history\|\|!s\)return false/);
  assert.match(lifeSource, /if\(mask\.classList\.contains\('show'\)&&mask\.querySelector\('\.life-chat-sheet'\)\)/);
  assert.match(lifeSource, /history\.innerHTML=messageHistoryMarkup\(s\)/);
  assert.match(lifeSource, /window\.addEventListener\('puffer-new-messages'/);
  assert.match(lifeSource, /window\.PufferLife\?\.markMessagesRead\?\.\(\)/);
  assert.match(lifeSource, /data-life-message-id=/);
  assert.match(lifeCssSource, /\.life-live-message-notice\{/);
  assert.match(lifeCssSource, /env\(safe-area-inset-top\)/);
});

test('Life overlays close with browser back and preserve page and tab scroll positions', () => {
  assert.match(lifeSource, /const tabScrollPositions = \{ today:0, days:0, things:0, us:0 \}/);
  assert.match(lifeSource, /tabScrollPositions\[previousPage\] = window\.scrollY/);
  assert.match(lifeSource, /targetScroll = changed \? tabScrollPositions\[page\] \|\| 0 : 0/);
  assert.match(lifeSource, /function lockPageScroll\(\)/);
  assert.match(lifeSource, /history\.pushState\(\{ \.\.\.previous, pufferOverlay:kind \}/);
  assert.match(lifeSource, /window\.addEventListener\('popstate'/);
  assert.match(lifeSource, /mask\.classList\.contains\('show'\)\) return closeSheet\(true\)/);
  assert.match(lifeSource, /window\.scrollTo\(0, lock\.y\)/);
  assert.match(appSource, /new CustomEvent\('puffer-modal-open'\)/);
  assert.match(appSource, /new CustomEvent\('puffer-modal-close'\)/);
  assert.match(lifeCssSource, /body\.life-mode\.life-sheet-open\{position:fixed/);
  assert.match(lifeCssSource, /\.life-sheet-body\{overscroll-behavior:contain;-webkit-overflow-scrolling:touch\}/);
});

test('hydration sync keeps both people records and propagates soft deletes', () => {
  const now = Date.now();
  const left = baseState('a');
  left.hydrationLog.push({
    id: 'water-a', author: 'a', kind: 'water', ml: 500, date: '2026-08-17',
    createdAt: now, updatedAt: now, deleted: false
  });
  const right = baseState('b');
  right.hydrationLog.push({
    id: 'drink-b', author: 'b', kind: 'drink', ml: 330, date: '2026-08-17',
    createdAt: now + 1, updatedAt: now + 1, deleted: false
  });

  const converged = converge(left, right);
  for (const state of [converged.left, converged.right, converged.server]) {
    const records = byId(state.hydrationLog);
    assert.equal(records.size, 2);
    assert.equal(records.get('water-a').ml, 500);
    assert.equal(records.get('drink-b').kind, 'drink');
  }

  const deletion = baseState('a');
  deletion.hydrationLog.push({
    ...left.hydrationLog[0], deleted: true, updatedAt: now + 100
  });
  const afterDelete = plain(sync.merge(clone(converged.right), plain(sync.serialize(deletion))));
  assert.equal(byId(afterDelete.hydrationLog).get('water-a').deleted, true);
  assert.equal(byId(afterDelete.hydrationLog).get('drink-b').deleted, false);
});

test('travel sync keeps concurrent places and applies the newer edit', () => {
  const now = Date.now();
  const left = baseState('a');
  left.travels.push({
    id: 'trip-hangzhou', author: 'a', place: '杭州', date: '2026-08-01', note: '旧备注',
    status: 'visited', lat: 30.2741, lng: 120.1551, dataUrl: '', url: '',
    createdAt: now, updatedAt: now, deleted: false
  });
  const right = baseState('b');
  right.travels.push(
    {
      ...left.travels[0], note: '一起看了晚霞', updatedAt: now + 100
    },
    {
      id: 'trip-dali', author: 'b', place: '大理', date: '2026-10-01', note: '想去看洱海',
      status: 'wish', lat: null, lng: null, dataUrl: '', url: '',
      createdAt: now + 10, updatedAt: now + 10, deleted: false
    }
  );

  const converged = converge(left, right);
  for (const state of [converged.left, converged.right, converged.server]) {
    const records = byId(state.travels);
    assert.equal(records.size, 2);
    assert.equal(records.get('trip-hangzhou').note, '一起看了晚霞');
    assert.equal(records.get('trip-dali').status, 'wish');
  }
});

test('challenge sync keeps both answers and deterministically resolves equal timestamps', () => {
  const now = Date.now();
  const left = baseState('a');
  left.challengeAnswers.push({
    id: '2026-08-17:a', date: '2026-08-17', questionId: 'daily-1', source: 'builtin',
    author: 'a', answer: 'option-a', createdAt: now, updatedAt: now, deleted: false
  });
  const right = baseState('b');
  right.challengeAnswers.push({
    id: '2026-08-17:b', date: '2026-08-17', questionId: 'daily-1', source: 'builtin',
    author: 'b', answer: 'option-b', createdAt: now + 1, updatedAt: now + 1, deleted: false
  });

  const converged = converge(left, right);
  for (const state of [converged.left, converged.right, converged.server]) {
    const answers = byId(state.challengeAnswers);
    assert.equal(answers.size, 2);
    assert.equal(answers.get('2026-08-17:a').answer, 'option-a');
    assert.equal(answers.get('2026-08-17:b').answer, 'option-b');
  }

  const first = { ...left.challengeAnswers[0], answer: 'option-a' };
  const second = { ...left.challengeAnswers[0], answer: 'option-c' };
  const leftOrder = plain(sync.mergeArr([first], [second]));
  const rightOrder = plain(sync.mergeArr([second], [first]));
  assert.deepEqual(leftOrder, rightOrder);
  assert.equal(leftOrder[0].answer, 'option-c');
});

test('room serialization includes recent hydration, travel and challenge tombstones', () => {
  const now = Date.now();
  const state = baseState('a');
  state.hydrationLog.push({ id: 'water-deleted', updatedAt: now, deleted: true });
  state.travels.push({ id: 'travel-deleted', updatedAt: now, deleted: true });
  state.challengeAnswers.push({ id: 'challenge-deleted', updatedAt: now, deleted: true });

  const payload = plain(sync.serialize(state));
  assert.deepEqual(payload.hydrationLog.map(item => item.id), ['water-deleted']);
  assert.deepEqual(payload.travels.map(item => item.id), ['travel-deleted']);
  assert.deepEqual(payload.challengeAnswers.map(item => item.id), ['challenge-deleted']);
  assert.deepEqual(payload.partners, state.settings.partners);
  assert.equal(Object.hasOwn(payload, 'settings'), false);
});

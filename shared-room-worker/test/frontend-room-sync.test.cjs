const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const projectRoot = resolve(__dirname, '..', '..');
const appSource = readFileSync(resolve(projectRoot, 'app.js'), 'utf8');

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

const sync = loadRoomSyncCore();
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

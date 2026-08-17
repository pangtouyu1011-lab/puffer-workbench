const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { Miniflare } = require('miniflare');

const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;
let mf;
let kv;
let db;
let tempRoot;
let migratedPushEndpoint;

async function request(path, init) {
  const response = await mf.dispatchFetch('http://localhost' + path, init);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { throw new Error(`non-JSON response ${response.status}: ${text}`); }
  return { status: response.status, body };
}

function roomPath(room, pass = '') {
  return `/api/v1/rooms/${encodeURIComponent(room)}?pass=${encodeURIComponent(pass)}`;
}

function putRoom(room, pass, baseRev, data, author = 'a') {
  return request(roomPath(room), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 1, roomId: room, pass, baseRev, author, data })
  });
}

function getRoom(room, pass) {
  return request(roomPath(room, pass), { method: 'GET' });
}

function postJson(path, body, method = 'POST') {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function pushPath(room, action) {
  return `/api/v1/rooms/${encodeURIComponent(room)}/push/${action}`;
}

function presencePath(room) {
  return `/api/v1/rooms/${encodeURIComponent(room)}/presence`;
}

async function applyMigration(filename) {
  const migration = readFileSync(resolve(__dirname, '..', 'migrations', filename), 'utf8')
    .replace(/^\s*--.*$/gm, '').trim();
  for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

before(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'puffer-room-sync-'));
  const bundlePath = process.env.PUFFER_WORKER_BUNDLE
    ? resolve(process.env.PUFFER_WORKER_BUNDLE)
    : resolve(__dirname, '..', '.wrangler-test-build', 'worker.js');
  mf = new Miniflare({
    scriptPath: bundlePath,
    modules: true,
    compatibilityDate: '2024-09-23',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { ROOMS: { className: 'RoomCoordinator', useSQLite: true, unsafePreventEviction: true } },
    kvNamespaces: ['BENCH'],
    d1Databases: ['DB'],
    r2Buckets: ['MEDIA'],
    resourceTmpPath: tempRoot
  });
  kv = await mf.getKVNamespace('BENCH');
  db = await mf.getD1Database('DB');
  await db.exec(
    'CREATE TABLE room_sync_index (' +
    'room_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, storage_backend TEXT NOT NULL' +
    ')'
  );
  await applyMigration('0003_room_records.sql');
  await applyMigration('0004_media_lifecycle.sql');
  await db.exec(
    'CREATE TABLE push_subscriptions (' +
    'room_id TEXT NOT NULL, person TEXT NOT NULL CHECK (person IN (\'a\', \'b\')), endpoint TEXT NOT NULL, ' +
    'p256dh TEXT NOT NULL, auth TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (room_id, endpoint)' +
    '); CREATE INDEX idx_push_subscriptions_room_person ON push_subscriptions(room_id, person)'
  );
  await db.prepare('INSERT INTO push_subscriptions (room_id, person, endpoint, p256dh, auth, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('legacy-old-room', 'a', 'https://push.example/legacy-duplicate', 'old-key', 'old-auth', 1000).run();
  await db.prepare('INSERT INTO push_subscriptions (room_id, person, endpoint, p256dh, auth, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('legacy-new-room', 'b', 'https://push.example/legacy-duplicate', 'new-key', 'new-auth', 2000).run();
  await applyMigration('0007_unique_push_endpoint.sql');
  migratedPushEndpoint = await db.prepare('SELECT room_id, person, updated_at FROM push_subscriptions WHERE endpoint = ?')
    .bind('https://push.example/legacy-duplicate').all();
  await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind('https://push.example/legacy-duplicate').run();
});

after(async () => {
  if (mf) await mf.dispose();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test('creates a room at revision 1 and returns one coherent snapshot', async () => {
  const data = { marker: 'initial', messages: [], todos: [] };
  const created = await putRoom('create-room', 'secret', 0, data);
  assert.equal(created.status, 200);
  assert.equal(created.body.rev, 1);

  const read = await getRoom('create-room', 'secret');
  assert.equal(read.status, 200);
  assert.equal(read.body.rev, 1);
  assert.deepEqual(read.body.data, data);
  assert.equal(typeof read.body.updatedAt, 'number');
});

test('mirrors travels and hydration records into readable D1 rows', async () => {
  const room = 'travel-hydration-mirror-room';
  const pass = 'mirror-secret';
  const travelPhoto = 'https://sync.20051011.xyz/api/v1/media/media/travel-trip-visited.jpg';
  const data = {
    travels: [
      {
        id: 'trip-visited', author: 'a', place: '杭州', date: '2026-08-01', note: '一起看了晚霞',
        status: 'visited', lat: 30.2741, lng: 120.1551, dataUrl: '', url: travelPhoto,
        createdAt: 1000, updatedAt: 1100, deleted: false
      },
      {
        id: 'trip-wish', author: 'b', place: '大理', date: '2026-10-01', note: '想去看洱海',
        status: 'wish', lat: null, lng: null, dataUrl: '', url: '',
        createdAt: 1050, updatedAt: 1150, deleted: false
      }
    ],
    hydrationLog: [
      {
        id: 'water-a-1', author: 'a', kind: 'water', ml: 250, date: '2026-08-17',
        createdAt: 1200, updatedAt: 1200, deleted: false
      },
      {
        id: 'drink-b-1', author: 'b', kind: 'drink', ml: 330, date: '2026-08-17',
        createdAt: 1250, updatedAt: 1300, deleted: false
      }
    ]
  };

  const saved = await putRoom(room, pass, 0, data);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rev, 1);

  const mirrored = await db.prepare(
    'SELECT record_type, record_id, payload, created_at, updated_at, deleted, last_revision ' +
    'FROM room_records WHERE room_id = ? ORDER BY record_type, record_id'
  ).bind(room).all();
  assert.equal(mirrored.results.length, 4);
  const rows = new Map(mirrored.results.map(row => [`${row.record_type}:${row.record_id}`, row]));
  for (const [type, item] of [
    ['travels', data.travels[0]],
    ['travels', data.travels[1]],
    ['hydrationLog', data.hydrationLog[0]],
    ['hydrationLog', data.hydrationLog[1]]
  ]) {
    const row = rows.get(`${type}:${item.id}`);
    assert.ok(row, `${type}:${item.id} should be mirrored`);
    assert.deepEqual(JSON.parse(row.payload), item);
    assert.equal(row.created_at, item.createdAt);
    assert.equal(row.updated_at, item.updatedAt);
    assert.equal(row.deleted, 0);
    assert.equal(row.last_revision, 1);
  }

  const mediaReference = await db.prepare(
    'SELECT record_type, record_id, active FROM media_references WHERE object_key = ? AND room_id = ?'
  ).bind('media/travel-trip-visited.jpg', room).first();
  assert.deepEqual(mediaReference, { record_type: 'travels', record_id: 'trip-visited', active: 1 });

  const index = await db.prepare(
    'SELECT revision, storage_backend FROM room_sync_index WHERE room_id = ?'
  ).bind(room).first();
  assert.deepEqual(index, { revision: 1, storage_backend: 'do+kv+d1-readable' });
});

test('round-trips hydration, travel and challenge data through both room clients', async () => {
  const room = 'three-feature-round-trip-room';
  const pass = 'round-trip-secret';
  const day = '2026-08-17';
  const leftData = {
    hydrationLog: [{
      id: 'round-water-a', author: 'a', kind: 'water', ml: 500, date: day,
      createdAt: 1400, updatedAt: 1400, deleted: false
    }],
    travels: [{
      id: 'round-trip-a', author: 'a', place: '杭州', date: '2026-08-01', note: '看晚霞',
      status: 'visited', lat: 30.2741, lng: 120.1551, dataUrl: '', url: '',
      createdAt: 1500, updatedAt: 1500, deleted: false
    }],
    challengeAnswers: [{
      id: `${day}:a`, date: day, questionId: 'daily-1', source: 'builtin', author: 'a',
      answer: 'option-a', createdAt: 1600, updatedAt: 1600, deleted: false
    }]
  };
  const firstSave = await putRoom(room, pass, 0, leftData, 'a');
  assert.equal(firstSave.status, 200);
  assert.equal(firstSave.body.rev, 1);

  const rightPull = await getRoom(room, pass);
  assert.equal(rightPull.status, 200);
  assert.deepEqual(rightPull.body.data, leftData);
  const rightData = {
    hydrationLog: [...rightPull.body.data.hydrationLog, {
      id: 'round-drink-b', author: 'b', kind: 'drink', ml: 330, date: day,
      createdAt: 1700, updatedAt: 1700, deleted: false
    }],
    travels: [...rightPull.body.data.travels, {
      id: 'round-trip-b', author: 'b', place: '大理', date: '2026-10-01', note: '想去洱海',
      status: 'wish', lat: null, lng: null, dataUrl: '', url: '',
      createdAt: 1800, updatedAt: 1800, deleted: false
    }],
    challengeAnswers: [...rightPull.body.data.challengeAnswers, {
      id: `${day}:b`, date: day, questionId: 'daily-1', source: 'builtin', author: 'b',
      answer: 'option-b', createdAt: 1900, updatedAt: 1900, deleted: false
    }]
  };
  const secondSave = await putRoom(room, pass, rightPull.body.rev, rightData, 'b');
  assert.equal(secondSave.status, 200);
  assert.equal(secondSave.body.rev, 2);

  const leftPull = await getRoom(room, pass);
  assert.equal(leftPull.status, 200);
  assert.equal(leftPull.body.rev, 2);
  assert.deepEqual(leftPull.body.data, rightData);

  const kvMirror = JSON.parse(await kv.get('room:' + room));
  assert.equal(kvMirror.rev, 2);
  assert.deepEqual(kvMirror.data, rightData);

  const d1Counts = await db.prepare(
    "SELECT record_type, COUNT(*) AS count FROM room_records WHERE room_id = ? " +
    "AND record_type IN ('hydrationLog', 'travels', 'challengeAnswers') GROUP BY record_type"
  ).bind(room).all();
  assert.deepEqual(
    Object.fromEntries(d1Counts.results.map(row => [row.record_type, row.count])),
    { challengeAnswers: 2, hydrationLog: 2, travels: 2 }
  );
  assert.deepEqual(
    await db.prepare('SELECT revision FROM room_sync_index WHERE room_id = ?').bind(room).first(),
    { revision: 2 }
  );
});

test('mirrors travel and hydration soft deletes at the new revision', async () => {
  const room = 'travel-hydration-delete-room';
  const pass = 'delete-secret';
  const travel = {
    id: 'trip-delete', author: 'a', place: '苏州', date: '2026-08-10', note: '', status: 'visited',
    lat: null, lng: null, dataUrl: '',
    url: 'https://sync.20051011.xyz/api/v1/media/media/travel-trip-delete.jpg',
    createdAt: 2000, updatedAt: 2000, deleted: false
  };
  const water = {
    id: 'water-delete', author: 'a', kind: 'water', ml: 300, date: '2026-08-17',
    createdAt: 2100, updatedAt: 2100, deleted: false
  };
  assert.equal((await putRoom(room, pass, 0, { travels: [travel], hydrationLog: [water] })).body.rev, 1);

  const deletedTravel = { ...travel, deleted: true, updatedAt: 3000 };
  const deletedWater = { ...water, deleted: true, updatedAt: 3100 };
  const saved = await putRoom(room, pass, 1, { travels: [deletedTravel], hydrationLog: [deletedWater] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rev, 2);

  const mirrored = await db.prepare(
    'SELECT record_type, record_id, payload, updated_at, deleted, last_revision ' +
    'FROM room_records WHERE room_id = ? ORDER BY record_type'
  ).bind(room).all();
  assert.equal(mirrored.results.length, 2);
  for (const row of mirrored.results) {
    const expected = row.record_type === 'travels' ? deletedTravel : deletedWater;
    assert.deepEqual(JSON.parse(row.payload), expected);
    assert.equal(row.updated_at, expected.updatedAt);
    assert.equal(row.deleted, 1);
    assert.equal(row.last_revision, 2);
  }

  const mediaReference = await db.prepare(
    'SELECT active FROM media_references WHERE object_key = ? AND room_id = ? AND record_type = ? AND record_id = ?'
  ).bind('media/travel-trip-delete.jpg', room, 'travels', travel.id).first();
  assert.deepEqual(mediaReference, { active: 0 });
  const index = await db.prepare('SELECT revision FROM room_sync_index WHERE room_id = ?').bind(room).first();
  assert.deepEqual(index, { revision: 2 });
});

test('does not publish a newer D1 revision when hydration mirroring fails', async () => {
  const room = 'hydration-mirror-failure-room';
  const pass = 'failure-secret';
  const initial = await putRoom(room, pass, 0, { travels: [], hydrationLog: [] });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.rev, 1);
  assert.deepEqual(
    await db.prepare('SELECT revision FROM room_sync_index WHERE room_id = ?').bind(room).first(),
    { revision: 1 }
  );

  await db.exec(
    "CREATE TRIGGER fail_hydration_mirror BEFORE INSERT ON room_records " +
    "WHEN NEW.room_id = 'hydration-mirror-failure-room' AND NEW.record_type = 'hydrationLog' " +
    "BEGIN SELECT RAISE(ABORT, 'forced hydration mirror failure'); END"
  );
  try {
    const data = {
      travels: [],
      hydrationLog: [{
        id: 'water-failure', author: 'b', kind: 'water', ml: 200, date: '2026-08-17',
        createdAt: 4000, updatedAt: 4000, deleted: false
      }]
    };
    const saved = await putRoom(room, pass, 1, data, 'b');
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rev, 2);

    const authoritative = await getRoom(room, pass);
    assert.equal(authoritative.body.rev, 2);
    assert.deepEqual(authoritative.body.data, data);
    assert.equal(
      await db.prepare(
        'SELECT record_id FROM room_records WHERE room_id = ? AND record_type = ?'
      ).bind(room, 'hydrationLog').first(),
      null
    );
    assert.deepEqual(
      await db.prepare('SELECT revision FROM room_sync_index WHERE room_id = ?').bind(room).first(),
      { revision: 1 }
    );
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS fail_hydration_mirror');
  }
});

test('push endpoint migration keeps only the newest legacy binding', () => {
  assert.equal(migratedPushEndpoint.results.length, 1);
  assert.equal(migratedPushEndpoint.results[0].room_id, 'legacy-new-room');
  assert.equal(migratedPushEndpoint.results[0].person, 'b');
  assert.equal(migratedPushEndpoint.results[0].updated_at, 2000);
});

test('atomically rejects one of two writes based on the same revision', async () => {
  const room = 'concurrent-room';
  await putRoom(room, 'secret', 0, { marker: 'base', messages: [], todos: [] });

  const [left, right] = await Promise.all([
    putRoom(room, 'secret', 1, { marker: 'left', messages: [{ id: 'left', text: 'L' }], todos: [] }),
    putRoom(room, 'secret', 1, { marker: 'right', messages: [{ id: 'right', text: 'R' }], todos: [] }, 'b')
  ]);
  assert.deepEqual([left.status, right.status].sort(), [200, 409]);
  const winner = left.status === 200 ? 'left' : 'right';
  const conflict = left.status === 409 ? left : right;
  assert.equal(conflict.body.error, 'conflict');
  assert.equal(conflict.body.rev, 2);

  const read = await getRoom(room, 'secret');
  assert.equal(read.body.rev, 2);
  assert.equal(read.body.data.marker, winner);

  const merged = {
    ...read.body.data,
    messages: [...read.body.data.messages, { id: 'retry', text: 'merged after conflict' }]
  };
  const retried = await putRoom(room, 'secret', read.body.rev, merged);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.rev, 3);
  const finalRead = await getRoom(room, 'secret');
  assert.equal(finalRead.body.rev, 3);
  assert.deepEqual(finalRead.body.data, merged);
});

test('seeds an existing KV room once without losing its revision or UTF-8 data', async () => {
  const room = 'legacy-seed-room';
  const data = { marker: '旧房间🐡', messages: [{ id: 'old', text: '保留我' }] };
  await kv.put('meta:' + room, JSON.stringify({ pass: 'legacy-pass', rev: 7, updatedAt: 7000 }));
  await kv.put('room:' + room, JSON.stringify({ data, rev: 7, updatedAt: 7000 }));

  const [first, second] = await Promise.all([getRoom(room, 'legacy-pass'), getRoom(room, 'legacy-pass')]);
  for (const result of [first, second]) {
    assert.equal(result.status, 200);
    assert.equal(result.body.rev, 7);
    assert.deepEqual(result.body.data, data);
  }

  await kv.put('room:' + room, JSON.stringify({ data: { marker: 'late stale overwrite' }, rev: 8, updatedAt: 8000 }));
  const stillAuthoritative = await getRoom(room, 'legacy-pass');
  assert.equal(stillAuthoritative.body.rev, 7);
  assert.deepEqual(stillAuthoritative.body.data, data);
});

test('does not initialize from a stale KV payload when metadata or D1 is newer', async () => {
  const metaAhead = 'legacy-meta-ahead';
  await kv.put('meta:' + metaAhead, JSON.stringify({ pass: 'secret', rev: 5, updatedAt: 5000 }));
  await kv.put('room:' + metaAhead, JSON.stringify({ data: { marker: 'stale' }, rev: 4, updatedAt: 4000 }));
  const metaResult = await getRoom(metaAhead, 'secret');
  assert.equal(metaResult.status, 503);
  assert.equal(metaResult.body.error, 'legacy_snapshot_unavailable');

  const d1Ahead = 'legacy-d1-ahead';
  await kv.put('meta:' + d1Ahead, JSON.stringify({ pass: 'secret', rev: 3, updatedAt: 3000 }));
  await kv.put('room:' + d1Ahead, JSON.stringify({ data: { marker: 'kv-rev-3' }, rev: 3, updatedAt: 3000 }));
  await db.prepare('INSERT INTO room_sync_index (room_id, revision, updated_at, storage_backend) VALUES (?, ?, ?, ?)')
    .bind(d1Ahead, 4, 4000, 'legacy-mirror').run();
  const d1Result = await getRoom(d1Ahead, 'secret');
  assert.equal(d1Result.status, 503);
  assert.equal(d1Result.body.error, 'legacy_snapshot_unavailable');

  await db.prepare('UPDATE room_sync_index SET revision = ? WHERE room_id = ?').bind(3, d1Ahead).run();
  const coherent = await getRoom(d1Ahead, 'secret');
  assert.equal(coherent.status, 200);
  assert.equal(coherent.body.rev, 3);
  assert.equal(coherent.body.data.marker, 'kv-rev-3');
});

test('never raises an initialized snapshot revision from a newer D1 mirror marker', async () => {
  const room = 'd1-does-not-raise-revision';
  const data = { marker: 'authoritative-rev-1', messages: [] };
  await putRoom(room, 'secret', 0, data);
  await db.prepare('UPDATE room_sync_index SET revision = ?, updated_at = ?, storage_backend = ? WHERE room_id = ?')
    .bind(99, 99000, 'stale-test-marker', room).run();

  const read = await getRoom(room, 'secret');
  assert.equal(read.status, 200);
  assert.equal(read.body.rev, 1);
  assert.deepEqual(read.body.data, data);
});

test('rejects wrong passwords and prevents accidental non-zero room creation', async () => {
  await putRoom('protected-room', 'right-pass', 0, { marker: 'private' });
  assert.equal((await getRoom('protected-room', 'wrong-pass')).status, 403);
  assert.equal((await putRoom('protected-room', 'wrong-pass', 1, { marker: 'overwrite' })).status, 403);

  assert.equal((await getRoom('missing-room', 'secret')).status, 404);
  const badCreate = await putRoom('missing-room', 'secret', 9, { marker: 'must not exist' });
  assert.equal(badCreate.status, 409);
  assert.equal(badCreate.body.rev, 0);
  assert.equal((await getRoom('missing-room', 'secret')).status, 404);
});

test('stores the exact 8 MiB payload across chunks and rejects one byte more', async () => {
  const jsonOverhead = Buffer.byteLength(JSON.stringify({ blob: '' }));
  const exactData = { blob: 'x'.repeat(MAX_ROOM_PAYLOAD_BYTES - jsonOverhead) };
  assert.equal(Buffer.byteLength(JSON.stringify(exactData)), MAX_ROOM_PAYLOAD_BYTES);
  const accepted = await putRoom('payload-limit-room', 'secret', 0, exactData);
  assert.equal(accepted.status, 200);
  const read = await getRoom('payload-limit-room', 'secret');
  assert.equal(read.status, 200);
  assert.equal(read.body.rev, 1);
  assert.equal(read.body.data.blob.length, exactData.blob.length);

  const tooLarge = { blob: exactData.blob + 'x' };
  const rejected = await putRoom('payload-limit-room', 'secret', 1, tooLarge);
  assert.equal(rejected.status, 413);
  assert.equal(rejected.body.error, 'payload_too_large');
});

test('push status matches the current endpoint and unsubscribe removes only that device', async () => {
  const room = 'push-device-room';
  const pass = 'push-secret';
  await putRoom(room, pass, 0, { messages: [] });
  const first = { endpoint: 'https://push.example/first', keys: { p256dh: 'first-key', auth: 'first-auth' } };
  const second = { endpoint: 'https://push.example/second', keys: { p256dh: 'second-key', auth: 'second-auth' } };
  for (const subscription of [first, second]) {
    const saved = await postJson(pushPath(room, 'subscribe'), { pass, person: 'a', subscription });
    assert.equal(saved.status, 200);
  }
  assert.equal((await postJson(pushPath(room, 'status'), { pass, person: 'a', endpoint: first.endpoint })).body.subscribed, true);
  assert.equal((await postJson(pushPath(room, 'status'), { pass, person: 'a', endpoint: 'https://push.example/missing' })).body.subscribed, false);

  const wrongPass = await postJson(pushPath(room, 'unsubscribe'), { pass: 'wrong', endpoint: first.endpoint });
  assert.equal(wrongPass.status, 403);
  const removed = await postJson(pushPath(room, 'unsubscribe'), { pass, endpoint: first.endpoint });
  assert.equal(removed.status, 200);
  assert.equal((await postJson(pushPath(room, 'status'), { pass, person: 'a', endpoint: first.endpoint })).body.subscribed, false);
  assert.equal((await postJson(pushPath(room, 'status'), { pass, person: 'a', endpoint: second.endpoint })).body.subscribed, true);
  assert.equal((await postJson(pushPath(room, 'unsubscribe'), { pass, endpoint: first.endpoint })).status, 200);
});

test('subscribing one browser endpoint to a new room removes its old room binding', async () => {
  const endpoint = 'https://push.example/moving-device';
  const subscription = { endpoint, keys: { p256dh: 'moving-key', auth: 'moving-auth' } };
  await putRoom('push-old-room', 'old-pass', 0, { messages: [] });
  await putRoom('push-new-room', 'new-pass', 0, { messages: [] });
  assert.equal((await postJson(pushPath('push-old-room', 'subscribe'), { pass: 'old-pass', person: 'a', subscription })).status, 200);
  assert.equal((await postJson(pushPath('push-new-room', 'subscribe'), { pass: 'new-pass', person: 'b', subscription })).status, 200);
  assert.equal((await postJson(pushPath('push-old-room', 'status'), { pass: 'old-pass', person: 'a', endpoint })).body.subscribed, false);
  assert.equal((await postJson(pushPath('push-new-room', 'status'), { pass: 'new-pass', person: 'b', endpoint })).body.subscribed, true);
});

test('presence returns distance without exposing coordinates and clears location immediately', async () => {
  const room = 'presence-private-room';
  const pass = 'presence-secret';
  await putRoom(room, pass, 0, { messages: [] });
  const first = await postJson(presencePath(room), { pass, person: 'a', location: { lat: 30.2741, lon: 120.1551 } });
  assert.equal(first.status, 200);
  const second = await postJson(presencePath(room), { pass, person: 'b', location: { lat: 31.2304, lon: 121.4737 } });
  assert.equal(second.status, 200);
  assert.equal(JSON.stringify(second.body).includes('"lat"'), false);
  assert.equal(JSON.stringify(second.body).includes('"lon"'), false);
  assert.equal(second.body.presence.every(item => typeof item.hasLocation === 'boolean'), true);
  assert.ok(second.body.distanceKm > 150 && second.body.distanceKm < 200);

  const cleared = await postJson(presencePath(room), { pass, person: 'a', location: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.distanceKm, null);
  assert.equal(cleared.body.presence.find(item => item.person === 'a').hasLocation, false);
  const stored = await kv.get(`presence:${room}:a`, { type: 'json' });
  assert.equal(stored.location, null);
  const listed = await kv.list({ prefix: `presence:${room}:a` });
  assert.equal(listed.keys.length, 1);
  assert.ok(Number(listed.keys[0].expiration) * 1000 > Date.now() + 8 * 60 * 1000);
  assert.ok(Number(listed.keys[0].expiration) * 1000 <= Date.now() + 11 * 60 * 1000);
});

test('deleting presence removes the person record and keeps the response private', async () => {
  const room = 'presence-leave-room';
  const pass = 'leave-secret';
  await putRoom(room, pass, 0, { messages: [] });
  await postJson(presencePath(room), { pass, person: 'a', location: { lat: 39.9042, lon: 116.4074 } });
  const removed = await postJson(presencePath(room), { pass, person: 'a' }, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.presence.find(item => item.person === 'a').lastSeen, 0);
  assert.equal(removed.body.presence.find(item => item.person === 'a').hasLocation, false);
  assert.equal(await kv.get(`presence:${room}:a`), null);
  assert.equal((await postJson(presencePath(room), { pass: 'wrong', person: 'b' }, 'DELETE')).status, 403);
});

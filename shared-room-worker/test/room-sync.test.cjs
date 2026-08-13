const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { Miniflare } = require('miniflare');

const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;
let mf;
let kv;
let db;
let tempRoot;

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

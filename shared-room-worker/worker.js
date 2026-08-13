// 河豚工作台 · 共享房间后端（Cloudflare Workers · service worker 格式）
// 接口约定：
//   GET  /api/:roomId?pass=ACCESS_PASS   -> { ok, data, rev, updatedAt }  (口令错403 / 房间不存在404)
//   PUT  /api/:roomId    body: { pass, data } -> { ok, rev, updatedAt }   (首次写入创建房间并设口令)
//   GET  /health                        -> { ok:true }
// 说明：前端负责按条目合并，后端只做「按房间存储 + 口令校验 + 版本号」。
//       KV 与 D1 通过 Worker 环境绑定注入。

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Room-Pass,Cache-Control'
};

// One KV value per room, with a bounded payload. Historical data is compacted by the client.
const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_D1_RECORD_BYTES = 900 * 1024;
const D1_MIRROR_BATCH_SIZE = 250;
const MEDIA_ORPHAN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const MEDIA_CLEANUP_BATCH_SIZE = 50;
import { buildPushPayload } from '@block65/webcrypto-web-push';

const COMPANION_MODEL = '@cf/meta/llama-3.1-8b-instruct';

function pushVapid(env) {
  if (!env.VAPID_SUBJECT || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}

function pushChanges(previous, next, author) {
  const sameDay = value => {
    const date = new Date(Number(value) || 0);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  };
  const fresh = (type, label, list) => {
    const oldIds = new Set(Array.isArray(previous?.[type]) ? previous[type].map(item => item?.id) : []);
    const item = (Array.isArray(list) ? list : []).find(value => value?.id && !oldIds.has(value.id) && value.author === author && sameDay(value.createdAt));
    return item ? { kind: type, title: `新的${label}`, body: item.text || item.caption || `TA 刚刚更新了${label}。`, tag: `puffer-${type}` } : null;
  };
  return fresh('messages', '留言', next?.messages) || fresh('gallery', '照片', next?.gallery) || fresh('todos', '待办', next?.todos) || null;
}

async function sendRoomPushes(env, room, author, change) {
  const vapid = pushVapid(env);
  if (!vapid || !env.DB || !change) return;
  try {
    const rows = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE room_id = ? AND person <> ?').bind(room, author).all();
    for (const row of rows.results || []) {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        const payload = await buildPushPayload({ data: JSON.stringify({ ...change, url: 'https://20051011.xyz/' }), options: { ttl: 86400 } }, subscription, vapid);
        const response = await fetch(subscription.endpoint, payload);
        if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE room_id = ? AND endpoint = ?').bind(room, row.endpoint).run();
      } catch (_) {}
    }
  } catch (_) {}
}

function beijingDay(value = Date.now()) {
  return new Date(Number(value) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function scheduledSlot(value = Date.now()) {
  const local = new Date(Number(value) + 8 * 60 * 60 * 1000);
  const hour = local.getUTCHours(), minute = local.getUTCMinutes();
  if (hour === 9 && minute === 0) return 'morning';
  if (hour === 12 && minute === 30) return 'noon';
  if (hour === 20 && minute === 30) return 'evening';
  return '';
}

function scheduledReminder(data, person, slot, day) {
  const messages = Array.isArray(data?.messages) ? data.messages.filter(item => !item.deleted && item.author === person && beijingDay(item.createdAt) === day) : [];
  const photos = Array.isArray(data?.gallery) ? data.gallery.filter(item => !item.deleted && item.author === person && beijingDay(item.createdAt) === day) : [];
  const status = data?.dailyStatus?.[day]?.[person];
  const fortune = data?.fortune?.date === day && data?.fortune?.by?.[person];
  const todos = Array.isArray(data?.todos) ? data.todos.filter(item => !item.deleted && item.date === day) : [];
  const todoDone = !todos.length || todos.every(item => item.done);
  if (fortune && status?.mood && messages.length && todoDone) return null;
  if (slot === 'morning') return { title: '胖头鱼的早安', body: '今天也慢慢开始吧，回来看看 TA 的状态。', tag: `puffer-reminder-${day}-morning` };
  if (slot === 'noon') return { title: '胖头鱼提醒你', body: '午饭和水都别忘了，忙了一上午，休息一下。', tag: `puffer-reminder-${day}-noon` };
  return { title: '今晚一起收一下', body: messages.length || photos.length ? '今天已经留下了一点东西，回来看看 TA 有没有新记录。' : '今天还没有留下共同记录，回来看看吧。', tag: `puffer-reminder-${day}-evening` };
}

async function aiScheduledReminder(env, room, data, person, slot, day) {
  const fallback = scheduledReminder(data, person, slot, day);
  if (!fallback || !env.AI || !env.DB) return fallback;
  const cacheSlot = `reminder-${slot}-${person}`;
  try {
    const cached = await env.DB.prepare('SELECT line FROM companion_lines WHERE room_id = ? AND day = ? AND slot = ?').bind(room, day, cacheSlot).first();
    if (cached?.line) return { ...fallback, body: cached.line };
    const messages = Array.isArray(data?.messages) ? data.messages.filter(item => !item.deleted && item.author === person && beijingDay(item.createdAt) === day).length : 0;
    const photos = Array.isArray(data?.gallery) ? data.gallery.filter(item => !item.deleted && item.author === person && beijingDay(item.createdAt) === day).length : 0;
    const mood = String(data?.dailyStatus?.[day]?.[person]?.mood || '还没有记录');
    const todos = Array.isArray(data?.todos) ? data.todos.filter(item => !item.deleted && item.date === day) : [];
    const remainingTodos = todos.filter(item => !item.done).length;
    const result = await env.AI.run(COMPANION_MODEL, {
      messages: [
        { role: 'system', content: '你是情侣生活工作台里的胖头鱼。只写一句自然、温柔、具体的中文提醒，18到36个汉字。不编造事实，不使用表情符号，不提及后台、模型或数据。' },
        { role: 'user', content: `北京时间${slot}提醒。今天是${day}。这个人今天心情：${mood}；留言${messages}条；照片${photos}张；未完成待办${remainingTodos}项。请提醒他回来看看共同生活或照顾自己。` }
      ],
      temperature: 0.7,
      max_tokens: 80
    });
    const line = cleanCompanionLine(result?.response, fallback.body);
    await env.DB.prepare('INSERT INTO companion_lines (room_id, day, slot, line, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, day, slot) DO NOTHING').bind(room, day, cacheSlot, line, Date.now()).run();
    return { ...fallback, body: line };
  } catch (_) {
    return fallback;
  }
}

async function scheduledPushes(env, scheduledTime) {
  const vapid = pushVapid(env);
  if (!vapid || !env.DB || !env.BENCH) return;
  const slot = scheduledSlot(scheduledTime);
  if (!slot) return;
  const day = beijingDay(scheduledTime);
  try {
    const rows = await env.DB.prepare('SELECT room_id, person, endpoint, p256dh, auth FROM push_subscriptions').all();
    const rooms = new Map();
    for (const row of rows.results || []) {
      if (!rooms.has(row.room_id)) {
        const rec = await env.BENCH.get('room:' + row.room_id, { type: 'json' });
        rooms.set(row.room_id, rec?.data || null);
      }
      const data = rooms.get(row.room_id);
      const reminder = await aiScheduledReminder(env, row.room_id, data, row.person, slot, day);
      if (!reminder) continue;
      try {
        const payload = await buildPushPayload({ data: JSON.stringify({ ...reminder, url: 'https://20051011.xyz/' }), options: { ttl: 86400 } }, { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, vapid);
        const response = await fetch(row.endpoint, payload);
        if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE room_id = ? AND endpoint = ?').bind(row.room_id, row.endpoint).run();
        else if (response.ok || response.status === 201) await env.DB.prepare('INSERT OR IGNORE INTO scheduled_pushes (room_id, person, day, slot, sent_at) VALUES (?, ?, ?, ?, ?)').bind(row.room_id, row.person, day, slot, Date.now()).run();
      } catch (_) {}
    }
  } catch (_) {}
}

function mediaKeysInPayload(payload) {
  const keys = new Set();
  const pattern = /\/api\/v1\/media\/(media\/[A-Za-z0-9-]+\.jpg)/g;
  let match;
  while ((match = pattern.exec(payload))) keys.add(match[1]);
  return [...keys];
}

async function cleanupOrphanMedia(env, now = Date.now()) {
  if (!env.DB || !env.MEDIA) return;
  const cutoff = now - MEDIA_ORPHAN_GRACE_MS;
  const candidates = await env.DB.prepare(
    'SELECT object_key FROM media_objects WHERE created_at < ? AND NOT EXISTS (' +
    'SELECT 1 FROM media_references WHERE media_references.object_key = media_objects.object_key AND media_references.active = 1' +
    ') ORDER BY created_at ASC LIMIT ?'
  ).bind(cutoff, MEDIA_CLEANUP_BATCH_SIZE).all();
  for (const row of candidates.results || []) {
    const key = String(row.object_key || '');
    if (!key) continue;
    // The object is registered by this lifecycle system, older than the grace
    // period, and has no active room record. Delete R2 first, then its metadata.
    await env.MEDIA.delete(key);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM media_references WHERE object_key = ?').bind(key),
      env.DB.prepare('DELETE FROM media_objects WHERE object_key = ?').bind(key)
    ]);
  }
}

function roomMirrorRecords(data, revision, now) {
  const records = [];
  const add = (type, id, value, fallbackUpdatedAt = now) => {
    if (id == null || value == null) return;
    let payload;
    try { payload = JSON.stringify(value); } catch (_) { return; }
    if (new TextEncoder().encode(payload).byteLength > MAX_D1_RECORD_BYTES) return;
    const createdAt = Number(value?.createdAt) || Number(fallbackUpdatedAt) || now;
    const updatedAt = Number(value?.updatedAt) || Number(fallbackUpdatedAt) || now;
    records.push({ type, id: String(id), payload, createdAt, updatedAt, deleted: value?.deleted ? 1 : 0 });
  };
  const arrays = ['todos', 'trainings', 'messages', 'gallery', 'meals', 'wishes'];
  arrays.forEach(type => {
    (Array.isArray(data?.[type]) ? data[type] : []).forEach(item => add(type, item?.id, item));
  });
  Object.entries(data?.dailyStatus || {}).forEach(([date, people]) => {
    Object.entries(people || {}).forEach(([person, value]) => add('daily_status', `${date}:${person}`, { date, person, ...value }));
  });
  Object.entries(data?.water || {}).forEach(([date, value]) => add('water', date, { date, value }));
  Object.entries(data?.interactionHistory || {}).forEach(([date, value]) => add('interaction_history', date, { date, ...value }));
  const fortune = data?.fortune;
  if (fortune?.date) Object.entries(fortune.by || {}).forEach(([person, value]) => {
    if (value) add('fortune', `${fortune.date}:${person}`, { date: fortune.date, person, value }, value.ts || now);
  });
  Object.entries(data?.fitnessPlan || {}).forEach(([day, value]) => add('fitness_plan', day, { day, ...value }));
  if (data?.partners && typeof data.partners === 'object') add('partners', 'current', data.partners);
  return records;
}

async function mirrorRoomToD1(env, room, revision, updatedAt, data) {
  if (!env.DB) return;
  try {
    const records = roomMirrorRecords(data, revision, updatedAt);
    const statement = env.DB.prepare(
      'INSERT INTO room_records (room_id, record_type, record_id, payload, created_at, updated_at, deleted, last_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(room_id, record_type, record_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, deleted = excluded.deleted, last_revision = excluded.last_revision ' +
      'WHERE room_records.payload <> excluded.payload OR room_records.deleted <> excluded.deleted'
    );
    for (let index = 0; index < records.length; index += D1_MIRROR_BATCH_SIZE) {
      const batch = records.slice(index, index + D1_MIRROR_BATCH_SIZE).map(record => statement.bind(
        room, record.type, record.id, record.payload, record.createdAt, record.updatedAt, record.deleted, revision
      ));
      if (batch.length) await env.DB.batch(batch);
    }
    const referenceRows = [];
    records.forEach(record => {
      mediaKeysInPayload(record.payload).forEach(objectKey => referenceRows.push({
        objectKey, type: record.type, id: record.id, active: record.deleted ? 0 : 1
      }));
    });
    const referenceStatement = env.DB.prepare(
      'INSERT INTO media_references (object_key, room_id, record_type, record_id, active, last_seen_at) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(object_key, room_id, record_type, record_id) DO UPDATE SET active = excluded.active, last_seen_at = excluded.last_seen_at'
    );
    for (let index = 0; index < referenceRows.length; index += D1_MIRROR_BATCH_SIZE) {
      const batch = referenceRows.slice(index, index + D1_MIRROR_BATCH_SIZE).map(reference => referenceStatement.bind(
        reference.objectKey, room, reference.type, reference.id, reference.active, updatedAt
      ));
      if (batch.length) await env.DB.batch(batch);
    }
    // Publish the D1 revision only after every record is queryable. Receivers can
    // then safely use this revision as the "all records committed" marker.
    await env.DB.prepare(
      'INSERT INTO room_sync_index (room_id, revision, updated_at, storage_backend) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(room_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, storage_backend = excluded.storage_backend'
    ).bind(room, revision, updatedAt, 'kv+d1-readable').run();
  } catch (_) {
    // D1 is currently a mirror only. Its failure must never delay or fail KV sync.
  }
}

async function mergeLatestD1Messages(env, room, data, fallbackRevision) {
  if (!env.DB) return { data, revision: fallbackRevision };
  try {
    const index = await env.DB.prepare('SELECT revision FROM room_sync_index WHERE room_id = ?').bind(room).first();
    const rows = await env.DB.prepare(
      "SELECT payload FROM room_records WHERE room_id = ? AND record_type = 'messages' ORDER BY updated_at DESC LIMIT 300"
    ).bind(room).all();
    const map = new Map();
    const put = item => {
      if (!item || item.id == null) return;
      const current = map.get(String(item.id));
      if (!current || Number(item.updatedAt || item.createdAt || 0) >= Number(current.updatedAt || current.createdAt || 0)) map.set(String(item.id), item);
    };
    (Array.isArray(data?.messages) ? data.messages : []).forEach(put);
    for (const row of rows.results || []) {
      try { put(JSON.parse(row.payload)); } catch (_) {}
    }
    const merged = data ? { ...data } : {};
    merged.messages = [...map.values()].sort((a, b) => Number(a.updatedAt || a.createdAt || 0) - Number(b.updatedAt || b.createdAt || 0));
    return { data: merged, revision: Math.max(Number(fallbackRevision) || 0, Number(index?.revision) || 0) };
  } catch (_) {
    return { data, revision: fallbackRevision };
  }
}

function companionSlot(now = new Date()) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 20) return 'evening';
  return 'night';
}

function companionDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function companionFallback(summary) {
  const lines = {
    morning: summary.todoCount ? `早上慢慢来，先从今天的第一件小事开始。` : '早上慢慢来，今天也给彼此留一点轻松。',
    noon: summary.partnerMood ? `到中午啦，先吃饭休息一会儿。TA 今天是「${summary.partnerMood}」。` : '到中午啦，先吃饭休息一会儿，也记得喝水。',
    afternoon: summary.todoCount ? `下午加油，先喝几口水，剩下的事慢慢做。` : '下午也别太赶，喝几口水再继续。',
    evening: summary.todayMoments ? '傍晚好，今天已经留下了一点共同生活。' : '傍晚好，有空时和 TA 说说今天的小事吧。',
    night: summary.todayMoments ? '今天的小瞬间已经收好啦，晚点一起回顾吧。' : '今天也辛苦了，想说的话可以留到晚安前。'
  };
  return lines[summary.slot] || lines.night;
}

function companionSummary(data, now = new Date()) {
  const day = companionDay(now);
  const active = list => Array.isArray(list) ? list.filter(item => item && !item.deleted) : [];
  const sameDay = value => {
    const date = new Date(Number(value) || 0);
    return !Number.isNaN(date.getTime()) && companionDay(date) === day;
  };
  const todos = active(data?.todos).filter(item => item.date === day && !item.done);
  const messages = active(data?.messages).filter(item => sameDay(item.createdAt)).length;
  const photos = active(data?.gallery).filter(item => sameDay(item.createdAt)).length;
  const statuses = data?.dailyStatus?.[day] || {};
  const moods = ['a', 'b'].map(person => String(statuses[person]?.mood || '').trim()).filter(Boolean);
  return { slot: companionSlot(now), todoCount: todos.length, todayMoments: messages + photos, moodCount: moods.length, partnerMood: moods[0] || '' };
}

function cleanCompanionLine(value, fallback) {
  const line = String(value || '').replace(/[\r\n]+/g, '').replace(/[“”"']/g, '').trim();
  return line && line.length <= 46 ? line : fallback;
}

async function getCompanionLine(env, room, data) {
  const now = new Date();
  const day = companionDay(now);
  const slot = companionSlot(now);
  const summary = companionSummary(data, now);
  const fallback = companionFallback(summary);
  if (!env.DB) return { line: fallback, source: 'rule', day, slot };
  const cached = await env.DB.prepare(
    'SELECT line FROM companion_lines WHERE room_id = ? AND day = ? AND slot = ?'
  ).bind(room, day, slot).first();
  if (cached?.line) return { line: cached.line, source: 'cache', day, slot };
  if (!env.AI) return { line: fallback, source: 'rule', day, slot };
  try {
    const result = await env.AI.run(COMPANION_MODEL, {
      messages: [
        { role: 'system', content: '你是情侣生活工作台里的胖头鱼。只写一句温柔、自然、克制的中文问候，14到34个汉字。不编造事实，不评价关系，不提及隐私，不使用表情符号、引号或标题。' },
        { role: 'user', content: `现在是${slot}。今天待办剩余${summary.todoCount}件；今天共同瞬间${summary.todayMoments}个；已记录心情${summary.moodCount}人；可参考心情${summary.partnerMood || '未记录'}。请只返回一句问候。` }
      ],
      temperature: 0.75,
      max_tokens: 80
    });
    const line = cleanCompanionLine(result?.response, fallback);
    await env.DB.prepare(
      'INSERT INTO companion_lines (room_id, day, slot, line, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, day, slot) DO NOTHING'
    ).bind(room, day, slot, line, Date.now()).run();
    // AI 问候只是短期展示缓存，半年后自动清理，避免 D1 无限制累积。
    if (slot === 'morning') {
      await env.DB.prepare('DELETE FROM companion_lines WHERE created_at < ?').bind(Date.now() - 180 * 24 * 60 * 60 * 1000).run();
    }
    return { line, source: 'ai', day, slot };
  } catch (_) {
    return { line: fallback, source: 'rule', day, slot };
  }
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    }, headers || {})
  });
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (url.pathname === '/health') {
    return json({ ok: true, storage: { kv: true, d1: !!env.DB }, ai: !!env.AI }, 200, cors);
  }

  if (url.pathname === '/api/v1/push/public-key' && request.method === 'GET') {
    const vapid = pushVapid(env);
    return vapid ? json({ ok: true, publicKey: vapid.publicKey }, 200, cors) : json({ error: 'push_unavailable' }, 503, cors);
  }

  // R2 保持私有：浏览器只经由 Worker 读写，桶本身不开放公网。
  // 读取 URL 使用不可猜测的对象键作为能力地址，不把房间口令写进同步数据。
  const publicMedia = url.pathname.match(/^\/api\/v1\/media\/(media\/[A-Za-z0-9-]+\.jpg)$/);
  if (publicMedia && request.method === 'GET') {
    if (!env.MEDIA) return json({ error: 'media_unavailable' }, 503, cors);
    const object = await env.MEDIA.get(publicMedia[1]);
    if (!object) return json({ error: 'not_found' }, 404, cors);
    const headers = new Headers(cors);
    object.writeHttpMetadata(headers);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    headers.set('ETag', object.httpEtag);
    return new Response(object.body, { status: 200, headers });
  }

  const presencePath = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/presence$/);
  if (presencePath && request.method === 'POST') {
    const room = decodeURIComponent(presencePath[1]);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const pass = String(body?.pass || '');
    const person = String(body?.person || '');
    if (!room || room.length > 64 || !['a', 'b'].includes(person)) return json({ error: 'bad_presence' }, 400, cors);
    const meta = await env.BENCH.get('meta:' + room, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
    const key = `presence:${room}:${person}`;
    const previous = await env.BENCH.get(key, { type: 'json' }) || {};
    let location = previous.location || null;
    if (Object.prototype.hasOwnProperty.call(body, 'location')) {
      const value = body.location;
      if (value === null) location = null;
      else {
        const lat = Number(value?.lat), lon = Number(value?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return json({ error: 'bad_location' }, 400, cors);
        location = { lat, lon, updatedAt: Date.now() };
      }
    }
    const now = Date.now();
    await env.BENCH.put(key, JSON.stringify({ person, lastSeen: now, location }));
    const records = await Promise.all(['a', 'b'].map(async id => {
      const rec = await env.BENCH.get(`presence:${room}:${id}`, { type: 'json' });
      if (!rec) return { person: id, lastSeen: 0, online: false, location: null };
      return { person: id, lastSeen: Number(rec.lastSeen) || 0, online: now - Number(rec.lastSeen || 0) <= 90000, location: rec.location || null };
    }));
    return json({ ok: true, now, presence: records }, 200, cors);
  }

  const companionPath = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/companion$/);
  if (companionPath && request.method === 'POST') {
    const room = decodeURIComponent(companionPath[1]);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const pass = String(body?.pass || '');
    if (!room || room.length > 64) return json({ error: 'bad_room' }, 400, cors);
    const meta = await env.BENCH.get('meta:' + room, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
    const rec = await env.BENCH.get('room:' + room, { type: 'json' });
    const result = await getCompanionLine(env, room, rec?.data || {});
    return json({ ok: true, ...result }, 200, cors);
  }

  const pushPath = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/push\/subscribe$/);
  if (pushPath && request.method === 'POST') {
    if (!env.DB) return json({ error: 'push_storage_unavailable' }, 503, cors);
    const room = decodeURIComponent(pushPath[1]);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const meta = await env.BENCH.get('meta:' + room, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== String(body?.pass || '')) return json({ error: 'forbidden' }, 403, cors);
    const person = String(body?.person || '');
    const subscription = body?.subscription || {};
    const endpoint = String(subscription.endpoint || '');
    const p256dh = String(subscription.keys?.p256dh || '');
    const auth = String(subscription.keys?.auth || '');
    if (!['a', 'b'].includes(person) || !endpoint || !p256dh || !auth || endpoint.length > 2048) return json({ error: 'bad_subscription' }, 400, cors);
    await env.DB.prepare('INSERT INTO push_subscriptions (room_id, person, endpoint, p256dh, auth, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(room_id, endpoint) DO UPDATE SET person = excluded.person, p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at').bind(room, person, endpoint, p256dh, auth, Date.now()).run();
    return json({ ok: true }, 200, cors);
  }

  const pushStatusPath = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/push\/status$/);
  if (pushStatusPath && request.method === 'POST') {
    if (!env.DB) return json({ error: 'push_storage_unavailable' }, 503, cors);
    const room = decodeURIComponent(pushStatusPath[1]);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const meta = await env.BENCH.get('meta:' + room, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== String(body?.pass || '')) return json({ error: 'forbidden' }, 403, cors);
    const person = String(body?.person || '');
    if (!['a', 'b'].includes(person)) return json({ error: 'bad_person' }, 400, cors);
    const row = await env.DB.prepare('SELECT updated_at FROM push_subscriptions WHERE room_id = ? AND person = ? ORDER BY updated_at DESC LIMIT 1').bind(room, person).first();
    return json({ ok: true, subscribed: !!row, updatedAt: row?.updated_at || 0 }, 200, cors);
  }

  const pushTestPath = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/push\/test$/);
  if (pushTestPath && request.method === 'POST') {
    if (!env.DB) return json({ error: 'push_storage_unavailable' }, 503, cors);
    const vapid = pushVapid(env);
    if (!vapid) return json({ error: 'push_unavailable' }, 503, cors);
    const room = decodeURIComponent(pushTestPath[1]);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const meta = await env.BENCH.get('meta:' + room, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== String(body?.pass || '')) return json({ error: 'forbidden' }, 403, cors);
    const person = String(body?.person || '');
    if (!['a', 'b'].includes(person)) return json({ error: 'bad_person' }, 400, cors);
    const rows = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE room_id = ? AND person = ?').bind(room, person).all();
    let sent = 0;
    for (const row of rows.results || []) {
      const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
      try {
        const payload = await buildPushPayload({ data: JSON.stringify({ title: '胖头鱼测试通知', body: '后台通知已经成功送达啦～', url: 'https://20051011.xyz/', tag: `puffer-test-${Date.now()}` }), options: { ttl: 300 } }, subscription, vapid);
        const response = await fetch(subscription.endpoint, payload);
        if (response.ok || response.status === 201) sent += 1;
        if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE room_id = ? AND endpoint = ?').bind(room, row.endpoint).run();
      } catch (_) {}
    }
    return json({ ok: true, sent }, 200, cors);
  }

  const v1 = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)$/);
  const legacy = url.pathname.match(/^\/api\/([^/]+)$/);
  const m = v1 || legacy;
  const mediaUpload = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)\/media$/);
  if (mediaUpload && request.method === 'POST') {
    if (!env.MEDIA) return json({ error: 'media_unavailable' }, 503, cors);
    const room = decodeURIComponent(mediaUpload[1]);
    const pass = url.searchParams.get('pass') || '';
    const meta = await env.BENCH.get('meta:' + room, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength && contentLength > MAX_MEDIA_UPLOAD_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return json({ error: 'data_required' }, 400, cors);
    if (bytes.byteLength > MAX_MEDIA_UPLOAD_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
    const key = 'media/' + crypto.randomUUID() + '.jpg';
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });
    // Lifecycle registration is best-effort. If D1 is unavailable, preserve the
    // uploaded image rather than failing a user's photo/message upload.
    if (env.DB) {
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO media_objects (object_key, room_id, created_at) VALUES (?, ?, ?)')
          .bind(key, room, Date.now()).run();
      } catch (_) {}
    }
    return json({ ok: true, key, url: url.origin + '/api/v1/media/' + key }, 201, cors);
  }
  if (!m) return json({ error: 'not_found' }, 404, cors);

  const room = decodeURIComponent(m[1]);
  const isV1 = !!v1;
  if (!room || room.length > 64) return json({ error: 'bad_room' }, 400, cors);
  const dataKey = 'room:' + room;
  const metaKey = 'meta:' + room;

  if (request.method === 'GET') {
    const pass = url.searchParams.get('pass') || '';
    const meta = await env.BENCH.get(metaKey, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
    const rec = await env.BENCH.get(dataKey, { type: 'json' });
    // KV 的两个 key 可能在不同边缘节点短暂不同步。
    // 因此客户端只能以“实际数据记录”携带的版本为准，不能把 meta 的
    // 较新版本和旧 data 混在一起返回；否则客户端会记住一个未拿到内容的
    // 版本号，之后错误地跳过真正的新数据。
    const dataRev = Number(rec && rec.rev) || 0;
    const dataUpdatedAt = Number(rec && rec.updatedAt) || 0;
    const readable = await mergeLatestD1Messages(env, room, rec ? rec.data : null, dataRev);
    return json(
      { ok: true, schemaVersion: 1, roomId: room, data: readable.data, rev: readable.revision, updatedAt: dataUpdatedAt },
      200, cors
    );
  }

  if (request.method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const pass = (body && body.pass) || '';
    if (isV1 && body && body.schemaVersion !== undefined && body.schemaVersion !== 1) return json({ error: 'unsupported_schema' }, 400, cors);
    if (!body || body.data === undefined) return json({ error: 'data_required' }, 400, cors);
    const payloadBytes = new TextEncoder().encode(JSON.stringify(body.data)).byteLength;
    if (payloadBytes > MAX_ROOM_PAYLOAD_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
    const meta = await env.BENCH.get(metaKey, { type: 'json' });
    const previous = await env.BENCH.get(dataKey, { type: 'json' });
    if (meta) {
      if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
      // 拒绝基于旧版本的写入。前端会重新拉取、按条目合并后再提交，
      // 这样双方同时编辑时不会发生“后一份整屋覆盖前一份”。
      const baseRev = Number(body.baseRev);
      if (!Number.isInteger(baseRev) || baseRev !== Number(meta.rev || 0)) {
        return json({ error: 'conflict', rev: Number(meta.rev || 0), updatedAt: meta.updatedAt }, 409, cors);
      }
    } else {
      if (!pass) return json({ error: 'pass_required' }, 400, cors);
      if (body.baseRev !== undefined && Number(body.baseRev) !== 0) return json({ error: 'conflict', rev: 0 }, 409, cors);
    }
    const rev = (meta ? meta.rev : 0) + 1;
    const now = Date.now();
    // 先写完整数据，再公布新版本。即使 KV 复制存在短暂延迟，GET 仍会以
    // dataKey 的 rev 为准，客户端会继续轮询，直到拿到这份实际内容。
    await env.BENCH.put(dataKey, JSON.stringify({ data: body.data, rev, updatedAt: now }));
    await env.BENCH.put(metaKey, JSON.stringify({ pass, rev, updatedAt: now }));
    // KV remains the source of truth. D1 mirrors individual records after the KV
    // write; failures are contained so the existing KV sync remains available.
    // Commit the queryable D1 mirror before notifying the other person. A push
    // must never arrive before the corresponding message can be read back.
    await mirrorRoomToD1(env, room, rev, now, body.data);
    const change = pushChanges(previous?.data || {}, body.data, String(body.data?.settings?.me || body.author || ''));
    const pushes = sendRoomPushes(env, room, String(body.data?.settings?.me || body.author || ''), change);
    if (ctx?.waitUntil) ctx.waitUntil(pushes);
    else pushes.catch(() => {});
    return json({ ok: true, schemaVersion: 1, roomId: room, rev, updatedAt: now }, 200, cors);
  }

  return json({ error: 'method_not_allowed' }, 405, cors);
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(scheduledPushes(env, controller.scheduledTime || Date.now()).catch(() => {}));
    ctx.waitUntil(cleanupOrphanMedia(env).catch(() => {}));
  }
};

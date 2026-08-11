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
  'Access-Control-Allow-Headers': 'Content-Type,X-Room-Pass'
};

// One KV value per room, with a bounded payload. Historical data is compacted by the client.
const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MEDIA_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_D1_RECORD_BYTES = 900 * 1024;
const D1_MIRROR_BATCH_SIZE = 250;
const COMPANION_MODEL = '@cf/meta/llama-3.1-8b-instruct';

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
    await env.DB.prepare(
      'INSERT INTO room_sync_index (room_id, revision, updated_at, storage_backend) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(room_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, storage_backend = excluded.storage_backend'
    ).bind(room, revision, updatedAt, 'kv+d1-mirror').run();
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
  } catch (_) {
    // D1 is currently a mirror only. Its failure must never delay or fail KV sync.
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
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
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
    return json(
      { ok: true, schemaVersion: 1, roomId: room, data: rec ? rec.data : null, rev: dataRev, updatedAt: dataUpdatedAt },
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
    // KV remains the source of truth. D1 mirrors records after the KV write and
    // runs in the background, so it cannot delay or interrupt the existing sync.
    const mirror = mirrorRoomToD1(env, room, rev, now, body.data);
    if (ctx?.waitUntil) ctx.waitUntil(mirror);
    else mirror.catch(() => {});
    return json({ ok: true, schemaVersion: 1, roomId: room, rev, updatedAt: now }, 200, cors);
  }

  return json({ error: 'method_not_allowed' }, 405, cors);
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  }
};

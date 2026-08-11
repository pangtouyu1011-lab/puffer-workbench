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

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
  });
}

async function handle(request, env) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (url.pathname === '/health') {
    return json({ ok: true, storage: { kv: true, d1: !!env.DB } }, 200, cors);
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
    } else {
      if (!pass) return json({ error: 'pass_required' }, 400, cors);
    }
    const rev = (meta ? meta.rev : 0) + 1;
    const now = Date.now();
    // 先写完整数据，再公布新版本。即使 KV 复制存在短暂延迟，GET 仍会以
    // dataKey 的 rev 为准，客户端会继续轮询，直到拿到这份实际内容。
    await env.BENCH.put(dataKey, JSON.stringify({ data: body.data, rev, updatedAt: now }));
    await env.BENCH.put(metaKey, JSON.stringify({ pass, rev, updatedAt: now }));
    // D1 is an index for the future relational migration. KV remains the source of truth
    // until room records are normalized and migrated in a separate, reversible step.
    if (env.DB) {
      try {
        await env.DB.prepare(
          'INSERT INTO room_sync_index (room_id, revision, updated_at, storage_backend) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(room_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, storage_backend = excluded.storage_backend'
        ).bind(room, rev, now, 'kv').run();
      } catch (_) {
        // Indexing failure must never interrupt the existing room sync path.
      }
    }
    return json({ ok: true, schemaVersion: 1, roomId: room, rev, updatedAt: now }, 200, cors);
  }

  return json({ error: 'method_not_allowed' }, 405, cors);
}

export default {
  fetch(request, env) {
    return handle(request, env);
  }
};

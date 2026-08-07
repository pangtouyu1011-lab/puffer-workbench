// 河豚工作台 · 共享房间后端（Cloudflare Workers · service worker 格式）
// 接口约定：
//   GET  /api/:roomId?pass=ACCESS_PASS   -> { ok, data, rev, updatedAt }  (口令错403 / 房间不存在404)
//   PUT  /api/:roomId    body: { pass, data } -> { ok, rev, updatedAt }   (首次写入创建房间并设口令)
//   GET  /health                        -> { ok:true }
// 说明：前端负责按条目合并，后端只做「按房间存储 + 口令校验 + 版本号」。
//       绑定 BENCH 以全局变量形式注入（service worker 格式）。

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// One KV value per room, with a bounded payload. Historical data is compacted by the client.
const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
  });
}

async function handle(request) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (url.pathname === '/health') {
    return json({ ok: true }, 200, cors);
  }

  const v1 = url.pathname.match(/^\/api\/v1\/rooms\/([^/]+)$/);
  const legacy = url.pathname.match(/^\/api\/([^/]+)$/);
  const m = v1 || legacy;
  if (!m) return json({ error: 'not_found' }, 404, cors);

  const room = decodeURIComponent(m[1]);
  const isV1 = !!v1;
  if (!room || room.length > 64) return json({ error: 'bad_room' }, 400, cors);
  const dataKey = 'room:' + room;
  const metaKey = 'meta:' + room;

  if (request.method === 'GET') {
    const pass = url.searchParams.get('pass') || '';
    const meta = await BENCH.get(metaKey, { type: 'json' });
    if (!meta) return json({ error: 'not_found' }, 404, cors);
    if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
    const rec = await BENCH.get(dataKey, { type: 'json' });
    return json(
      { ok: true, schemaVersion: 1, roomId: room, data: rec ? rec.data : null, rev: meta.rev, updatedAt: meta.updatedAt },
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
    const meta = await BENCH.get(metaKey, { type: 'json' });
    if (meta) {
      if (meta.pass !== pass) return json({ error: 'forbidden' }, 403, cors);
    } else {
      if (!pass) return json({ error: 'pass_required' }, 400, cors);
    }
    const rev = (meta ? meta.rev : 0) + 1;
    const now = Date.now();
    await BENCH.put(metaKey, JSON.stringify({ pass, rev, updatedAt: now }));
    await BENCH.put(dataKey, JSON.stringify({ data: body.data, rev, updatedAt: now }));
    return json({ ok: true, schemaVersion: 1, roomId: room, rev, updatedAt: now }, 200, cors);
  }

  return json({ error: 'method_not_allowed' }, 405, cors);
}

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request));
});

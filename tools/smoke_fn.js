// 冒烟测试已部署的 Edge Function（无需 token / 无需 anon key）
// 验证：函数可达、service_role 能绕过 RLS 命中 DB
// 用法：node smoke_fn.js
const REF = 'chfczfrkgndgudcxoump';
const BASE = `https://${REF}.supabase.co/functions/v1`;

async function call(slug, body, headers = {}) {
  const res = await fetch(`${BASE}/${slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

(async () => {
  // 1) 坏 JSON → 400 bad_json
  const badJson = await fetch(`${BASE}/room-get`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  console.log('bad-json:', badJson.status, await badJson.text());

  // 2) 不存在的房间 → 404 not_found（证明函数用 service_role 命中 DB 且 RLS 不挡）
  const notFound = await call('room-get', { id: '__smoke_nonexistent_xyz__', pass: 'x' });
  console.log('not-found:', JSON.stringify(notFound));

  // 3) 短路 OPTIONS（CORS 预检）
  const opt = await fetch(`${BASE}/room-put`, { method: 'OPTIONS' });
  console.log('options:', opt.status);
})();

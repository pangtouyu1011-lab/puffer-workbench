// Supabase Edge Function: room-get
// 部署：supabase functions deploy room-get --project-ref chfczfrkgndgudcxoump
// 作用：匿名接收 {id, pass}，用 service_role 走 PostgREST 查 DB，
//       用 PBKDF2 验证 pass，验证通过后返回房间 data + rev。
//       支持自动迁移：旧明文 pass 行首次用正确口令访问时，自动升级为哈希并清空明文。
//       全程 pass 不返回客户端、最终也不以明文停留在表里。
// 零外部依赖：仅使用 Deno 内置 fetch / crypto.subtle。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PBKDF2_ITER = 100000;

const hits = new Map();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t: number) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= 60;
}

async function pbkdf2(pass: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pass),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    key,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function genSalt(bytes = 16): Uint8Array {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return a;
}
function b64u(a: Uint8Array): string {
  return btoa(String.fromCharCode(...a));
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function authHeaders() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function dbSelect(id: string): Promise<any | null> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(
    `${url}/rest/v1/rooms?select=id,data,rev,pass,pass_hash,pass_salt,pass_iter,updated_at&id=eq.${encodeURIComponent(id)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error('db');
  const arr = await res.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

// 自动迁移：用明文 pass 校验通过后，写入哈希并清空明文
async function migrate(id: string, pass: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const salt = genSalt();
  const hash = await pbkdf2(pass, salt, PBKDF2_ITER);
  const res = await fetch(`${url}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      pass_hash: hash,
      pass_salt: b64u(salt),
      pass_iter: PBKDF2_ITER,
      pass: null,
    }),
  });
  if (!res.ok) throw new Error('migrate:' + res.status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: CORS });
  }

  const ip = req.headers.get('x-forwarded-for') || 'local';
  if (!rateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_json' }), {
      status: 400,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
  const id = String(body.id || '').trim();
  const pass = String(body.pass || '');
  if (!id || !pass || id.length > 64 || pass.length > 128) {
    return new Response(JSON.stringify({ error: 'bad_input' }), {
      status: 400,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  let row: any;
  try {
    row = await dbSelect(id);
  } catch {
    return new Response(JSON.stringify({ error: 'db' }), {
      status: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  if (!row) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  // 未迁移（无哈希）：尝试用明文 pass 校验并自动迁移
  if (!row.pass_hash || !row.pass_salt) {
    if (typeof row.pass === 'string' && row.pass.length && row.pass === pass) {
      try {
        await migrate(id, pass);
      } catch {
        return new Response(JSON.stringify({ error: 'db' }), {
          status: 500,
          headers: { ...CORS, 'content-type': 'application/json' },
        });
      }
      // 迁移完成，返回最新数据
      return new Response(
        JSON.stringify({ ok: true, data: row.data, rev: row.rev, updatedAt: row.updated_at }),
        { headers: { ...CORS, 'content-type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        error: 'need_migration',
        hint: '请在已记住口令的设备上发起一次同步以升级口令存储',
      }),
      { status: 409, headers: { ...CORS, 'content-type': 'application/json' } },
    );
  }

  // 已迁移：用哈希校验
  const got = await pbkdf2(pass, fromB64(row.pass_salt), row.pass_iter || PBKDF2_ITER);
  if (!timingSafeEqual(got, row.pass_hash)) {
    await new Promise((r) => setTimeout(r, 250));
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, data: row.data, rev: row.rev, updatedAt: row.updated_at }),
    { headers: { ...CORS, 'content-type': 'application/json' } },
  );
});

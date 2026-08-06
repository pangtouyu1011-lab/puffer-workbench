// Supabase Edge Function: room-put
// 部署：supabase functions deploy room-put --project-ref chfczfrkgndgudcxoump
// 作用：匿名接收 {id, pass, data, rev?}，验证 pass（PBKDF2，或首次明文）后 upsert 写入。
//   - 写入时生成随机 salt 并用 PBKDF2 把 pass 哈希后存入 pass_hash，明文 pass 置空。
//   - 支持自动迁移：旧明文 pass 行首次用正确口令写入时，自动升级为哈希。
//   - 支持乐观锁：客户端可传 rev，若与服务端当前 rev 不一致返回 conflict。
// 零外部依赖：仅使用 Deno 内置 fetch / crypto.subtle。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PBKDF2_ITER = 100000;
const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;

const hits = new Map();
function rateLimit(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t: number) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= 60;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
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

async function dataDigest(data: unknown): Promise<{ hash: string; bytes: number }> {
  const raw = JSON.stringify(data);
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hash, bytes: bytes.byteLength };
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

function authHeaders() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function dbSelectMeta(id: string): Promise<any | null> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(
    `${url}/rest/v1/rooms?select=rev,pass,pass_hash,pass_salt,pass_iter&id=eq.${encodeURIComponent(id)}`,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error('db');
  const arr = await res.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function dbUpsert(row: any): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL')!;
  const res = await fetch(`${url}/rest/v1/rooms`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates, return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('upsert:' + res.status + ' ' + t.slice(0, 200));
  }
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
  const data = body.data;
  const expectedDataHash = String(body.dataHash || '');
  const prevRev = body.rev;
  if (!id || !pass || data === undefined || id.length > 64 || pass.length > 128) {
    return new Response(JSON.stringify({ error: 'bad_input' }), {
      status: 400,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const incomingDigest = await dataDigest(data);
  if (incomingDigest.bytes > MAX_ROOM_PAYLOAD_BYTES) {
    return new Response(JSON.stringify({ error: 'payload_too_large' }), {
      status: 413,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
  if (expectedDataHash && expectedDataHash !== incomingDigest.hash) {
    return new Response(JSON.stringify({ error: 'data_hash_mismatch' }), {
      status: 400,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  let row: any;
  try {
    row = await dbSelectMeta(id);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'db', detail: String(e.message) }), {
      status: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  if (row) {
    let authed = false;
    if (!row.pass_hash || !row.pass_salt) {
      // 未迁移：尝试明文校验
      if (typeof row.pass === 'string' && row.pass.length && row.pass === pass) {
        authed = true; // 写入时会生成哈希，即完成迁移
      }
    } else {
      const got = await pbkdf2(pass, fromB64(row.pass_salt), row.pass_iter || PBKDF2_ITER);
      if (timingSafeEqual(got, row.pass_hash)) authed = true;
    }
    if (!authed) {
      await new Promise((r) => setTimeout(r, 250));
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }
    if (prevRev != null && Number(prevRev) !== Number(row.rev)) {
      return new Response(JSON.stringify({ error: 'conflict', rev: row.rev }), {
        status: 409,
        headers: { ...CORS, 'content-type': 'application/json' },
      });
    }
  }

  // 写入：生成新 salt + hash，明文 pass 置空
  const salt = genSalt();
  const hash = await pbkdf2(pass, salt, PBKDF2_ITER);
  // 单调递增 rev：杜绝「同毫秒 / 时钟回拨」导致两设备 rev 相同或倒退
  const newRev = Math.max(Date.now(), (row ? Number(row.rev) : 0) + 1);

  try {
    await dbUpsert({
      id,
      data,
      rev: newRev,
      pass_hash: hash,
      pass_salt: b64u(salt),
      pass_iter: PBKDF2_ITER,
      pass: null,
      updated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'db', detail: String(e.message) }), {
      status: 500,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    rev: newRev,
    dataHash: incomingDigest.hash,
    bytes: incomingDigest.bytes,
  }), {
    headers: { ...CORS, 'content-type': 'application/json' },
  });
});

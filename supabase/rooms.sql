-- 河豚工作台 · 共享房间 Supabase 建表脚本
-- 用途：在工作台「🤝 共享房间」里用作两人协作的存储后端。
-- 在 Supabase 控制台 → SQL Editor → 新建查询 → 粘贴本段 → Run 即可。
-- 说明：anon key 是公开密钥，配合下面的设置（关闭 RLS）可让前端直接读写。
--       适合「两个人约定口令」的轻量协作；若需要更严格的权限，请自行加 RLS 策略。

create table if not exists public.rooms (
  id          text primary key,
  data        jsonb,
  rev         bigint,
  pass        text,
  updated_at  timestamptz default now()
);

-- 关闭行级安全：让 anon 角色可以直接读写（前端用 anon key 调用）
alter table public.rooms disable row level security;

-- （可选）若将来想加索引，可取消注释：
-- create index if not exists rooms_updated_at_idx on public.rooms (updated_at desc);

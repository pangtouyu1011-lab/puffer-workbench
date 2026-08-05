-- ============================================================
-- PufferWork 同步安全修复（Supabase）
-- 触发原因：Supabase Advisor 报告 public.rooms 未启用 RLS，
--   anon key 在前端公开，意味着任何拿到 anon key 的人都能
--   读 / 改 / 删所有房间的数据（包括明文 pass）。
-- 执行位置：Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. 启用 RLS（启用后 anon 默认无任何权限，必须显式策略才能访问）
alter table public.rooms enable row level security;

-- 2. 显式撤销 anon / authenticated 对 rooms 表的所有权限
--    （RLS 启用后默认也是拒绝，这里双保险）
revoke all on table public.rooms from anon;
revoke all on table public.rooms from authenticated;

-- 3. 增加 pass 哈希相关列（PBKDF2-SHA256）
--    旧明文 pass 列暂保留用于兼容 / 迁移，前端部署 Edge Function 后不再使用
alter table public.rooms add column if not exists pass_salt  text;
alter table public.rooms add column if not exists pass_hash  text;
alter table public.rooms add column if not exists pass_iter  integer default 100000;

-- 4. 强制 row security（即使表 owner 也受 RLS 约束）
alter table public.rooms force row level security;

-- 5. 验证当前 RLS 状态（应返回 relrowsecurity = true）
select relname, relrowsecurity, relforcerowsecurity
  from pg_class
 where relname = 'rooms';

-- 6. 验证 anon 已无权限（应返回空 = 没有授予的权限）
select grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'rooms';

-- 7. （可选，约一周后所有人迁移完成再执行）删除旧明文 pass 列
-- alter table public.rooms drop column pass;
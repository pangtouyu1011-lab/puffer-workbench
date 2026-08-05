# PufferWork 同步安全修复（Supabase）

## 问题（来自 Supabase Advisor 通知）
`public.rooms` 表未启用 RLS，且 `anon` key 暴露在前端代码里。
结果：任何拿到 anon key 的人都能 **读 / 改 / 删** 所有房间数据，包括明文 `pass`。

## 修复方案
1. **启用 RLS + 撤销 anon/authenticated 直访权限** → anon 再也无法直接碰表。
2. **两个 Edge Function 做中间层**（用 service_role，绕过 RLS）：
   - `room-get`：POST `{id, pass}` → PBKDF2 校验 → 返回房间数据（pass 永不返回）。
   - `room-put`：POST `{id, pass, data}` → 校验 → upsert，pass 以 **PBKDF2-SHA256 哈希**入库，明文 `pass` 置空。
3. **自动迁移**：旧明文 `pass` 行首次用正确口令访问时，函数自动升级为哈希并清空明文，**无需手动跑迁移 SQL、无需告知口令**。
4. 速率限制（每 IP 每分钟 60 次）+ 错误口令 250ms 延迟，拖慢爆破。

## 文件
- `sql/fix-rls.sql` — 启用 RLS / 撤销权限 / 加哈希列（**已通过 Management API 执行**）
- `functions/room-get/index.ts` — Edge Function（**已部署**）
- `functions/room-put/index.ts` — Edge Function（**已部署**）
- `config.toml` — `verify_jwt = false`（函数自校验口令，不依赖 Supabase 登录）
- `tools/run_sql.js` — 用 PAT 调 Management API 执行 SQL（token 仅走环境变量，不落盘）
- `tools/smoke_fn.js` — 部署后冒烟测试函数可达性

## 前端改动（app.js）
`roomGet` / `roomPut` 改为请求 `/functions/v1/room-get`、`/functions/v1/room-put`，
不再直接访问 `rest/v1/rooms`。失败码映射：
- `forbidden` → 「口令错误」
- `not_found` → 「房间不存在」
- `need_migration` → 「请在原设备同步一次」（正常不会被触发，因已自动迁移）
- `conflict` → 「版本冲突，请稍后重试」

## 执行记录
- CLI：`supabase` v2.111.0（二进制直装，路径 `node/workspace/supabase-cli/extracted/supabase.exe`）
- 项目 ref：`chfczfrkgndgudcxoump`
- 部署顺序：先部署两个函数 → 再跑 SQL 启用 RLS → 最后部署新版前端。

## 验证
- 函数冒烟：`POST room-get` 坏 JSON→400；不存在房间→404；OPTIONS→200。
- 端到端：刷新前端后，**用正确口令同步一次**即完成自动迁移（明文→哈希）。
- 安全：启用 RLS 后，旧前端直接 403，anon 无法直读 `rooms`。

## 收尾（可选，迁移稳定后）
确认所有设备都已同步过一次后，可删除明文列：
```sql
alter table public.rooms drop column pass;
```

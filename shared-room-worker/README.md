# 河豚工作台 · 共享房间后端

让「两个人共享同一个工作台」的免费后端。

本目录配置的后端架构为 **Cloudflare Worker + Durable Objects + KV + D1 + R2**；正式服务通过自定义域名 `https://sync.20051011.xyz` 提供。不要改回国内网络不稳定的 `*.workers.dev`，也不要重新切换到已停用的 Supabase 方案。

## 它能做什么

- 为「共享房间」功能提供带**访问口令**的云端存储
- 前端两人各填同一个「房间地址 + 房间 ID + 口令」，即可实时同步：待办 / 健身记录 / 素材库 / 推文 / AI 视频
- SQLite Durable Object 原子保存每个房间的完整快照和版本号
- KV 保存兼容快照，D1 保存逐条镜像，R2 保存照片
- 数据按条目合并，删除也会同步（不会互相覆盖）

## 部署步骤

> 前置：需要一个 Cloudflare 账号（免费，https://dash.cloudflare.com/sign-up）

有两种方式，效果完全一样，任选其一：

### 使用命令行 Wrangler

> 前置：本机需要安装 Node.js + npm（https://nodejs.org，装 LTS 版即可）

1. 安装依赖并登录 Wrangler（Cloudflare 命令行）

   ```bash
   npm install
   npx wrangler login
   ```

2. 确认 `wrangler.toml` 中的 KV、D1、R2 和路由属于目标 Cloudflare 账号。

3. 先执行完整本地测试，再部署；Wrangler 会按 `exports.RoomCoordinator` 创建 SQLite Durable Object 命名空间。

   ```bash
   npm test
   npx wrangler deploy
   ```

   部署成功会返回一个地址，类似：

   ```
   https://puffer-share.<你的子域>.workers.dev
   ```

4. 验证（可选）

   ```bash
   curl https://puffer-share.<你的子域>.workers.dev/health
   # 返回 {"ok":true}
   ```

## 国内访问注意（重要）

生产环境固定使用自定义域名 `sync.20051011.xyz`。`*.workers.dev` 在部分中国大陆网络下可能不可达，因此只用于 Cloudflare 内部默认地址，不写回前端设置。

> 本后端使用 ES module Worker。部署必须同时包含 `ROOMS` Durable Object、`BENCH` KV、`DB` D1、`MEDIA` R2 和 `AI` 绑定；不要只在网页编辑器中粘贴单个 `worker.js` 文件。

## 在工作台里使用

打开工作台右上角 ⚙️ 设置 → 找到 **「🤝 共享房间（两人协作）」** 区块：

- **房间地址**：填上面的 `https://puffer-share.<你的子域>.workers.dev`
- **房间 ID**：两人约定一个相同的字符串（如 `pangtouyu`）
- **访问口令**：两人约定一个相同的口令（首次写入即生效，之后换口令需重建房间）
- 点 **「🤝 加入房间」**，两人都加入同一个房间即可开始共享

> 提示：口令用于区分不同房间、防止陌生人写入，请两人私下约定，不要公开。

## 费用

Cloudflare 免费额度：每天 10 万次 KV 读取、1000 万次写入，个人两人使用完全够用，不收费。

## 接口约定（给想自建/二次开发的同学）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/:roomId?pass=口令` | 读取房间数据 `{ ok, data, rev, updatedAt }`（房间不存在 404，口令错 403） |
| PUT | `/api/:roomId` | 写入，body `{ pass, baseRev, data }`；首次写入需 `baseRev: 0`，冲突返回 409 |
| GET | `/health` | 健康检查 |

合并逻辑在前端完成（按条目 ID 合并、deleted 软删除标记优先），后端只负责「按房间存储 + 口令校验 + 版本号」。

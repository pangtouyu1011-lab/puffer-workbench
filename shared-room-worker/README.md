# 河豚工作台 · 共享房间后端

让「两个人共享同一个工作台」的免费后端。

> **🇨🇳 国内用户看这里**：`*.workers.dev` 在大陆经常被墙，所以前端现在**默认用 Supabase**（`../supabase/SUPABASE_SETUP.md`，国内一般可访问、免费、不用域名）。本目录是 **Cloudflare Workers + KV** 方案，适合你**已有自有域名**、能给 Worker 配自定义域名的情况。

前端「🤝 共享房间」**同时支持两种后端**，在设置里一键切换：
- **Supabase（推荐，国内可访问）** → 见 `../supabase/SUPABASE_SETUP.md`
- **Cloudflare Workers（需自有域名）** → 见下文

## 它能做什么

- 为「共享房间」功能提供带**访问口令**的云端存储
- 前端两人各填同一个「房间地址 + 房间 ID + 口令」，即可实时同步：待办 / 健身记录 / 素材库 / 推文 / AI 视频
- 数据按条目合并，删除也会同步（不会互相覆盖）

## 部署步骤

> 前置：需要一个 Cloudflare 账号（免费，https://dash.cloudflare.com/sign-up）

有两种方式，效果完全一样，任选其一：

### 路线 A：网页后台（不装任何软件，推荐）

1. 打开 https://dash.cloudflare.com ，左侧菜单 **Workers 和 Pages** → 顶部 **KV** → **创建命名空间**
   - 名称填 `BENCH` → 创建后，**复制它的「ID」**（一长串字母数字）
2. 左侧菜单 **Workers 和 Pages** → **创建** → **创建 Worker**
   - 名称填 `puffer-share` → 点 **部署**（先用默认代码部署一次，拿到 `*.workers.dev` 子域）
3. 进入该 Worker → **编辑代码**，把里面的默认代码**全部删掉**，粘贴本目录 `worker.js` 的内容 → **保存并部署**
4. 进入该 Worker → **设置** → **变量** → **KV 命名空间绑定** → **添加绑定**
   - 变量名填 `BENCH`（必须和代码里的 binding 完全一致）→ 选中第 1 步创建的命名空间 → **保存**
5. 回到 Worker 首页，复制地址，类似：
   ```
   https://puffer-share.<你的子域>.workers.dev
   ```

### 路线 B：命令行 Wrangler

> 前置：本机需要安装 Node.js + npm（https://nodejs.org，装 LTS 版即可）

1. 安装并登录 Wrangler（Cloudflare 命令行）

   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. 在本目录创建 KV 命名空间，记下输出的 **id**

   ```bash
   wrangler kv namespace create BENCH
   # 输出示例：
   # { "binding": "BENCH", "id": "3a4b5c6d7e8f90a1b2c3d4e5f6a7b8c9" }
   ```

3. 把 `wrangler.toml` 里的 `REPLACE_WITH_YOUR_KV_ID` 换成上一步的 id

4. 部署

   ```bash
   wrangler deploy
   ```

   部署成功会返回一个地址，类似：

   ```
   https://puffer-share.<你的子域>.workers.dev
   ```

5. 验证（可选）

   ```bash
   curl https://puffer-share.<你的子域>.workers.dev/health
   # 返回 {"ok":true}
   ```

## 国内访问注意（重要）

`*.workers.dev` 免费子域名在中国大陆经常被 DNS 污染 / 屏蔽，手机和电脑可能连不上共享房间。如果你没有自有域名：

1. **直接用 Supabase（最省事）**：见 `../supabase/SUPABASE_SETUP.md`，免费、不用域名、国内一般可访问，前端已原生支持。
2. **挂自定义域名**：把自有域名加到 Cloudflare，给本 Worker 配子域名（如 `share.你的域名.com`）并开启橙色云代理，自定义域名通常可达。

> 本后端代码使用 **service worker 格式**（绑定 `BENCH` 以全局变量注入），可直接通过 Cloudflare API 部署：
> `PUT /accounts/{accountId}/workers/scripts/puffer-share`（Content-Type: application/javascript，body 为 worker.js 源码），
> 再用 `PUT .../scripts/puffer-share/bindings` 绑定 KV，或把 bindings 写进部署 metadata。无需网页操作，适合自动化 / 委托部署。

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
| PUT | `/api/:roomId` | 写入，body `{ pass, data }`；首次写入创建房间并设口令，返回 `{ ok, rev, updatedAt }` |
| GET | `/health` | 健康检查 |

合并逻辑在前端完成（按条目 ID 合并、deleted 软删除标记优先），后端只负责「按房间存储 + 口令校验 + 版本号」。

# 胖头鱼情侣工作台 · 当前项目交接文档

> 更新时间：2026-08-13  
> 当前线上版本：`20260813-notification-accuracy-1`
> 正式网站：<https://20051011.xyz>  
> 同步 API：<https://sync.20051011.xyz>  
> GitHub：<https://github.com/pangtouyu1011-lab/puffer-workbench>

这份文档是当前项目状态的交接基准。后续维护者开始工作前，应先阅读本文件和 `AGENTS.md`。历史说明里凡是提到 CloudStudio、Supabase、`*.workers.dev` 或“D1/R2 尚未接入”的内容，均已过期。

## 1. 项目目标

这是一个只供两个人使用的情侣共同生活工作台，核心价值不是打卡，而是：

- 看见对方今天的心情、留言、抽签和在线状态；
- 低成本记录照片、待办、训练、心愿和日常小事；
- 晚上、每周和每月回顾共同生活；
- 通过胖头鱼角色、天气形象、轻互动和小窝增加陪伴感；
- 在手机 Safari、添加到主屏幕的 PWA 和电脑浏览器中保持一致体验。

视觉方向是 iOS 原生信息层级 + 温暖生活感 + 少量像素胖头鱼 IP。不要重新做成手账、游戏任务墙或复杂仪表盘。

## 2. 当前生产架构

```text
Safari / PWA / 桌面浏览器
        │
        ├── Cloudflare Pages（前端）
        │     └── 20051011.xyz
        │
        └── Cloudflare Worker API
              └── sync.20051011.xyz
                    ├── SQLite Durable Object：权威房间快照、原子 revision
                    ├── KV：兼容快照、在线状态
                    ├── D1：逐条镜像、同步索引、推送订阅、定时通知记录
                    ├── R2：私有照片对象
                    └── Workers AI：规则问候的可选自然化文案
```

关键原则：前端只能调用 Worker API，不直接访问 KV、D1 或 R2。未来迁移数据库时，应优先保持 API 形状不变。

### Cloudflare 绑定

- Worker 名称：`puffer-share`
- Durable Object binding：`ROOMS`，类名 `RoomCoordinator`，SQLite 存储
- KV binding：`BENCH`
- D1 binding：`DB`，数据库名 `pufferwork-db`
- R2 binding：`MEDIA`，桶名 `pufferwork-media-private`
- AI binding：`AI`
- Pages 项目：`pufferwork`
- Worker 自定义路由：`sync.20051011.xyz/*`

绑定 ID 和密钥以 Cloudflare 后台、`wrangler.toml` 和 Worker Secrets 为准。交接文档不得记录房间口令、Cloudflare API Token、GitHub Token、VAPID 私钥或其他秘密。

## 3. 前端代码结构

项目是无框架、无构建步骤的原生 HTML/CSS/JavaScript SPA。

| 文件 | 职责 |
|---|---|
| `index.html` | 页面骨架、PWA 元信息、资源版本参数、版本自动刷新逻辑 |
| `app.js` | 状态、localStorage、房间同步、合并规则、上传、设置、旧页面兼容逻辑 |
| `life.js` | 当前四个主页面、所有主要 Bottom Sheet、胖头鱼、小窝、回顾和互动入口 |
| `life.css` 及 `life-*.css` | 当前 iOS 风格页面和组件样式 |
| `push.js` | Web Push 权限、订阅和状态查询 |
| `service-worker.js` | PWA 更新、缓存策略、后台通知和通知点击行为 |
| `_headers` | Pages 的浏览器缓存响应头 |
| `version.json` | 当前线上资源版本；PWA 更新判断依据 |
| `scripts/bump-version.mjs` | 同步更新 `index.html` 和 `version.json` 的版本工具 |
| `shared-room-worker/worker.js` | 全部 Worker API、D1/KV/R2、推送、AI 文案和定时任务 |
| `shared-room-worker/migrations/` | D1 表结构迁移，按编号顺序执行 |
| `assets/` | 正在使用的胖头鱼、天气、状态、PWA 图标；优先使用 WebP |

`supabase/`、`tools/`、QA 截图和本机保活脚本已经从 GitHub 移除，并在 `.gitignore` 中标记为本机遗留内容。不要重新提交。

## 4. 核心状态与数据规则

前端以一个 `state` 对象为本地副本，主要包含：

- `todos`
- `trainings`
- `messages`
- `gallery`
- `meals`（历史兼容）
- `wishes`
- `water`
- `dailyStatus`
- `interactionHistory`
- `fortune`
- `fitnessPlan`
- `settings`

### 必须遵守的合并规则

1. 新条目必须有稳定唯一 `id`、`createdAt`、`updatedAt`。
2. 删除必须软删除：`deleted = true` 并更新 `updatedAt`，不能直接从数组物理移除。
3. 数组使用 `mergeArr()` 按 `id` 合并：删除标记优先，其次较新的 `updatedAt` 胜出。
4. 所有渲染和计数必须通过 `live()` 排除软删除条目。
5. 不得用一台设备的整份状态无条件覆盖另一台设备。
6. 不得在读取到空房间、错误响应或超时后自动把空数据上传到云端。

### 当前同步上限

同步 payload 会在序列化阶段限制增长，本地完整状态不会被物理截断：

- 待办：500 条
- 训练：300 条
- 留言：300 条
- 相册同步记录：60 条；当前界面最多保存 5 张
- 吃饭记录：300 条
- 心愿：200 条
- 软删除墓碑保留 90 天
- `dailyStatus` 约保留 400 天
- 喝水数据约保留 180 天
- 单次房间 payload 上限：8 MB

不要随意提高上限。需要保留更多历史时，应先扩展 D1 归档读取接口，而不是继续增大整房间 JSON。

## 5. 同步链路

### 本机写入

1. 用户操作修改 `state`。
2. `save()` 立即写入 localStorage，并触发界面更新。
3. 已加入房间时，`scheduleRoomPush()` 防抖后经 Worker PUT 上传。
4. Worker 在该房间的 SQLite Durable Object 中原子校验 `baseRev` 并提交完整快照；同一旧版本的并发写入只能成功一次。
5. Worker 把已提交快照镜像到 KV，并把数组条目镜像到 D1。
6. D1 条目全部可读后，Worker 才发送对应 Web Push。

### 对方接收

- 页面在前台时每 3 秒拉取一次；回到前台或收到 Service Worker 消息时立即拉取。
- Worker GET 只返回同一个 Durable Object 快照中的完整数据、`rev` 和 `updatedAt`，不会混入其他存储来源的更高 revision。
- 旧 KV 房间在第一次访问时无损迁移到 Durable Object；若 KV 的 meta、data 或 D1 索引暂时版本不一致，则返回 503 等待复制完成，不以旧数据初始化权威快照。
- 点击留言通知时，PWA 会先拉取房间，再打开留言 Bottom Sheet。

### 同步问题排查顺序

1. 查看 `https://sync.20051011.xyz/health` 是否返回 `ok: true`，并确认 Durable Object、KV、D1 可用。
2. 检查两台设备的房间 ID、口令和成员身份 A/B 是否一致，不能只看昵称。
3. 检查右上角同步胶囊和设置里的最近错误。
4. 确认 Worker PUT 成功并返回递增 revision、D1 `room_records` 出现对应镜像，再检查接收端 GET。
5. 最后才检查 UI；通知出现只证明推送成功，不代表接收端已经执行了最新前端代码。

## 6. 图片与缓存

### 图片写入

1. 前端压缩照片。
2. 调用房间媒体上传 API。
3. Worker 校验房间口令与 2 MB 上传上限。
4. 图片写入私有 R2，业务条目只保存 Worker 媒体 URL。
5. Worker 读取 R2 时返回一年 `immutable` 缓存头。

旧数据中可能仍有 data URL，必须继续兼容显示，不能批量删除或强制迁移。

### 当前防重复加载策略

同步更新会重新生成页面文字，但 `life.js` 会按原始 `src` 复用已经加载的用户照片 DOM 节点，避免 Safari 重新请求或重新解码全部旧照片。只有图片新增、删除或 URL 改变时才应加载新图片。

维护时不要：

- 给 R2 图片 URL 每次附加随机时间戳；
- 在每次同步后主动清空图片缓存；
- 把已加载图片全部替换成新 `<img>`；
- 把大图重新塞回同步 JSON；
- 发布时复制 `assets/*-source.png` 或 QA 截图。

### 静态资源缓存

- `index.html`、`version.json`、`service-worker.js`：禁止缓存；
- JS/CSS：必须重新验证；
- `assets/*`：缓存一天，并允许一周 stale-while-revalidate；
- PWA 核心脚本使用 network-first，网络失败时才回退缓存。

## 7. PWA 与通知

- Safari 网站和桌面 PWA 可能使用不同的 Service Worker 生命周期；发布后第一次应彻底关闭 PWA再打开。
- 每次功能发布都必须更新 `version.json`、`index.html` 资源参数；涉及缓存策略时同时修改 `CACHE_NAME`。
- 后台推送要求：HTTPS、用户授权、有效 Push Subscription、Worker 中有效 VAPID Secrets。
- 当前设备的 Push Subscription endpoint 在 D1 中全局唯一；退出房间、换房间或切换 A/B 身份会解绑旧订阅，离线失败会在下次联网时重试。
- 新留言、照片和待办使用各自条目 ID 作为通知标识；已启用 Web Push 时，前台只显示站内提示，不再重复创建第二条系统通知。
- 点击留言、照片或待办通知时，已打开的页面会直接进入对应功能；PWA 冷启动则通过 `?open=` 参数完成同样的跳转。
- 在线状态 KV 只保留 10 分钟；位置接口只向客户端返回位置是否有效、更新时间和双方距离，不返回任何一方的精确经纬度。关闭位置会清空坐标，退出房间会删除对应在线记录。
- 定时通知由 Worker Cron 触发；发送前先在 D1 `scheduled_pushes` 原子占位，保证同一成员每个时段最多发送一次，全部设备均发送失败时才释放占位供平台重试。
- 当前 Cron 以 UTC 写在 `wrangler.toml`；修改前必须换算北京时间并检查是否会重复发送。
- 胖头鱼前台气泡、回顾弹窗和系统后台通知是三套不同机制，不要混为一谈。

## 8. 当前主要功能

### 今天

- 顶部共同照片轮播
- 天气与天气胖头鱼
- 对方在线/几分钟前来过/共享位置距离
- 对方心情、抽签、星座提醒和留言摘要
- 今日待办
- 双人互动完成度与连续互动天数
- 双平台音乐推荐
- 星座与抽签入口

### 日子

- 在一起天数
- 全部待办：新增、编辑、完成状态
- 月历与月份切换

### 小事

- 共同照片上传、查看、删除
- 训练按日期合并、查看和编辑
- 留言对话、图片留言、自动滚到底部
- 心愿墙与点亮

### 我们

- 两人资料和共同记录统计
- 胖头鱼小窝
- 共同相册、心愿、我们与同步设置

### 陪伴

- 可拖动胖头鱼悬浮宠物
- 心情/时间/页面对应形象
- 呼吸、眨眼、游泳、偶发爱心或星星
- 规则化早中晚问候和可选 AI 自然化文案
- 晚间、每周、每月回顾

## 9. 发布流程

### 发布前检查

```powershell
node --check app.js
node --check life.js
node --check push.js
node --check service-worker.js
node --check shared-room-worker/worker.js
git diff --check
git status --short
```

必须确认没有提交：Token、房间口令、QA 截图、浏览器配置、Supabase 遗留、本机工具或私人优化文档。

### 更新 PWA 版本

```powershell
node scripts/bump-version.mjs 20260813-feature-name-1
```

如果修改了 Service Worker 缓存策略，还要手动更新 `service-worker.js` 中的 `CACHE_NAME`。

### 部署 Worker

仅在 `shared-room-worker/` 有生产代码或配置改动时执行：

```powershell
cd shared-room-worker
npx wrangler deploy
```

新增 D1 migration 时，先确认 SQL 不会删除、覆盖或重写现有房间数据，再远程执行迁移。

### 部署 Pages

Pages 使用 Direct Upload。必须创建全新的白名单临时目录，只复制：

- 运行所需 HTML、JS、CSS、manifest、headers、version；
- `git ls-files 'assets/*'` 返回的已跟踪资源。

禁止直接部署整个仓库。部署命令：

```powershell
npx wrangler pages deploy <白名单目录> --project-name pufferwork
```

### 发布后验证

1. `version.json` 返回新版本；
2. `service-worker.js` 和主要 JS 是新内容；
3. Worker `/health` 正常；
4. 手机 Safari 和 PWA 均能打开；
5. 两台设备发送唯一测试留言，几秒内收到并出现在留言页；
6. 同步新文字时，首页旧照片不整批闪烁重载；
7. 新增、查看、删除一张测试照片；
8. 检查设置、待办、训练、抽签、留言和底部导航没有退回旧视觉。

### GitHub

当前正式代码在 `main`。推送前只暂存本次文件，不使用 `git add -A`。如果 `gh auth status` 失效，普通 `git push` 可能仍能使用系统 Git 凭据，但创建 PR 前应重新执行 `gh auth login -h github.com`。

## 10. 数据安全禁区

1. 不清空 KV 房间，不创建空房间覆盖已有房间。
2. 不对 R2 做无引用判断之外的批量删除。
3. 不使用 `git reset --hard`、强制推送或覆盖用户本机未提交文件。
4. 不把 Supabase 重新作为生产后端。
5. 不把 Worker 地址改回 `*.workers.dev`。
6. 不取消软删除和按条目合并规则。
7. 不因为 UI 没显示就假定云端没数据；先审计 KV、D1 和 API 返回。
8. 不在没有备份和双端验证的情况下重写数据模型。

## 11. 当前已知技术债

- `app.js` 和 `life.js` 仍较大，历史兼容逻辑较多；不要一次性大重构。
- 前端仍保留部分旧页面实现，当前 `life.js` 是主要可见界面。删除旧代码前必须做完整入口审计。
- Durable Object 是权威完整快照；KV 是回滚兼容镜像，D1 主要承担逐条镜像和通知可读性。回滚到不认识 `ROOMS` 的旧 Worker 会重新引入并发覆盖风险，禁止直接回滚旧 Worker。
- Web Push 在 iOS 上依赖用户授权、PWA 安装状态和系统策略，不能承诺绝对实时；前台 3 秒轮询仍是同步兜底。
- 当前相册 UI 上限 5 张偏保守。扩大前应先设计历史相册分页和 D1 查询，不要只改常量。
- 完整 Chrome 性能追踪需要配置 chrome-devtools MCP；当前日常验证以代码检查、生产响应头和真实设备体验为主。

## 12. 下一位维护者的接手顺序

1. 阅读本文件和 `AGENTS.md`。
2. 执行 `git status -sb`，确认工作区状态，不覆盖用户文件。
3. 访问正式站点和 Worker health，记录当前线上版本。
4. 先复现问题，再检查最终生效的函数与样式定义。
5. 修改后完成语法、引用、同步和手机 PWA验证。
6. Worker 与 Pages 分开部署，先后端、后前端。
7. 发布后再提交 GitHub，并记录版本和验证结果。

交接完成的标准不是“代码能打开”，而是：两台真实设备在同一房间中，留言、照片、待办和状态能够安全合并；PWA 能及时更新；已有照片不会因普通同步反复重新加载；任何失败都不会造成已有数据被空状态覆盖。

# 河豚工作台 (PufferWork) — AI 维护指南 (AGENTS.md / CODEX.md)

本文件供 OpenAI Codex、Claude Code、Copilot 等 AI 编程助手阅读。改动代码前请先读「核心架构」与「安全规则」。

## 这是什么
孙大炮 & 童大侠 的二人共享网页工作台。纯前端 SPA，**无构建步骤、无框架、无打包器**。
线上部署在 Cloudflare Pages：https://20051011.xyz

## 技术栈
- 单页应用：HTML + 自写 CSS + 原生 JavaScript（vanilla，全局变量，无模块系统）
- 视觉风格：像素风，主色 #FF8C42（橙）/ #FFF4E0（米）/ #4A2C17（棕）
- 数据：localStorage 为主 + Cloudflare Worker KV 跨设备同步（`https://sync.20051011.xyz`）

## 文件结构
- `index.html` — 全部页面骨架 + 内联 `<style>`（部分组件样式）+ PWA 声明（apple-touch-icon / manifest）
- `styles.css` — 全局样式
- `app.js` — 全部业务逻辑（约 79KB 单文件，是主要编辑对象）
- `assets/` — 图标（puffer.png 像素胖头鱼原图，puffer-180/192/512.png 派生图标）
- `site.webmanifest` — PWA 清单
- `supabase/rooms.sql` + `supabase/SUPABASE_SETUP.md` — 后端建表说明（已代部署，保留）
- `shared-room-worker/` — Worker 后端旧部署脚本；当前生产 Worker 使用自定义域名 `https://sync.20051011.xyz`

## 核心架构（改代码前必读）
1. **单一状态对象 `state`**：`{ partners:{a,b}, todos, trainings, messages, gallery, meals, fitnessPlan, settings }`。所有数据挂在它上面。
2. **持久化**：`save()` 写 localStorage；若已加入共享房间，`scheduleRoomPush()`（防抖 1s）把数据推到 Cloudflare Worker KV。
3. **同步合并规则（务必遵守，否则双端数据损坏）**：
   - 删除 = **软删除** `item.deleted = true`，**不要物理移除数组元素**。
   - 按 `id` 合并：`deleted` 优先 → `updatedAt` 较新者胜 → 平局取本地。
   - 数组统一用 `mergeArr(local, remote)`；所有渲染/计数用 `live(arr)` 过滤已删除项。
   - 新增条目务必带 `id`（用 `genId()`）+ `updatedAt = Date.now()`。
4. **共享后端**：默认使用 `state.settings.room = { backend:'worker', url:'https://sync.20051011.xyz', id, pass, joined, ... }`。Supabase 仅保留为备用后端。

## 安全规则
- `app.js` 里的 Supabase anon key（`sb_publishable_...`）是**公开的客户端 key**，可提交。
- 切勿提交任何 `sbp_...` / `cfut_...` 私密令牌（正常不存在于代码中）。

## 常见改动清单
- 视觉改版必须覆盖所有可达页面与弹层（今天、日子、待办日历、星座抽签、小事、留言、训练、心愿、相册管理、设置）；不得只更新首页而让任何新版入口跳回旧视觉页面。
- 改两人称呼/文案：搜 `partners`、各处标题模板字符串。
- 加新模块页面：① `index.html` 加 `page-xxx` 区块 + 侧边栏/bottom-nav 入口；② `app.js` 加 render/modal/`onPageEnter` 分支；③ `serializeRoom`/`mergeState` 纳入新数组（否则不同步）。
- 加待办字段：注意 `todoToICS`、日历 `renderCalendar`、每周清理 `runWeeklyCleanup` 都要兼容。
- 改视觉：优先 `styles.css`，组件级可放 `index.html` 内联 `<style>`。

## 本地测试
- JS 语法：`node --check app.js`（Node 路径 `c:/Users/woqutech/.workbuddy/binaries/node/versions/22.22.2/node.exe`）
- 本地预览：`python -m http.server` 起服务，或回 WorkBuddy 跑部署预览。

## 部署（改完必须重新部署才上线）
线上跑的是 CloudStudio 的**副本**，本地改完不会自动生效。两种方式：
1. **回 WorkBuddy** 说「部署更新后的网站」，让小豚重跑 CloudStudio 部署（目录 `personal-workbench`，入口 `index.html`）。
2. **发布**：代码维护在 GitHub；Cloudflare Pages 当前为 Direct Upload，代码推送后需按发布流程重新部署，不要假设会自动构建。

## 已知坑
- 共享后端使用自定义域名 `sync.20051011.xyz`，不要改回容易受网络影响的 `*.workers.dev` 默认地址。
- 照片上传经 `compressImage`（最长边 ≤1280px，JPEG 0.8）；`GALLERY_MAX = 5`。
- 每周自动清理：7 天前、且带 `createdAt` 的待办/留言会被软删；首次运行只设基线不删。
- iOS 日历：纯前端生成 `.ics`（data URI 下载），仅 iOS Safari 点开弹系统日历添加界面。
- 时区/日期：待办 `date` 字段为 `YYYY-MM-DD` 本地日期字符串。

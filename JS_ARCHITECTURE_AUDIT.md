# JS Architecture Audit

审计日期：2026-08-14  
审计范围：`app.js`、`life.js`、`push.js`、`service-worker.js`、`shared-room-worker/worker.js`  
审计性质：只读分析。本次没有修改 JavaScript、CSS、数据结构或 Worker 行为。

## 结论摘要

当前项目不是“两个页面各自独立运行”，而是一个双层结构：

```text
旧核心运行时 app.js
  ├─ 状态、localStorage、Worker 同步
  ├─ 旧 Dashboard / Modal / 领域 CRUD
  ├─ 媒体压缩与 R2 上传
  ├─ 音乐、天气、待办、训练、喝水等能力
  └─ window.PufferLife 公共适配层

新 Life 界面 life.js
  ├─ 今天 / 日子 / 小事 / 我们页面
  ├─ Bottom Sheet 与交互路由
  ├─ 回顾、旅行、默契、喝水、陪伴宠物
  └─ 通过 window.PufferLife 调用 app.js

push.js + service-worker.js + Worker
  └─ Web Push 订阅、浏览器接收、服务端发送
```

最重要的判断：

1. `app.js` 仍然是状态和同步的唯一事实来源，暂时不应直接拆动。
2. `life.js` 主要是 UI 编排层，但还包含较多业务判断、派生统计和 localStorage 行为。
3. `training` 已经从产品方向上被旅行记录取代，但当前仍被 `app.js`、`life.js`、同步 payload 和回顾统计使用，属于“遗留但仍可达”的功能，不能按 dead code 直接删除。
4. `meal` 也仍然存在于状态初始化、迁移、同步压缩、合并逻辑和旧 UI 路径中；当前喝水/饮料新功能并没有彻底移除它。
5. 推送不是单一文件功能，而是 `push.js` 注册订阅、Service Worker 接收展示、Worker 查询 D1 并发送的三段式链路。
6. 当前最适合的下一步不是立即拆模块，而是先建立稳定的边界和只读测试，再逐步把 `app.js` 的能力迁移到独立模块。

## 审计对象概览

| 文件 | 规模 | 当前角色 |
|---|---:|---|
| `app.js` | 3261 行，约 189 KB | 核心运行时、状态、旧 UI、领域逻辑、同步客户端、公共 API |
| `life.js` | 226 行，约 99 KB | 新 Life UI、渲染、Bottom Sheet、交互路由；单行很长，物理行号不适合作为模块边界 |
| `push.js` | 98 行，约 5.8 KB | Push 订阅与服务器订阅状态客户端 |
| `service-worker.js` | 93 行，约 3.9 KB | PWA 缓存、更新、Push 接收与通知点击 |
| `shared-room-worker/worker.js` | 924 行，约 50.5 KB | Worker API、Durable Object、KV、D1、R2、Presence、Push、AI 问候 |

## 1. `app.js` 当前职责分类

### 1.1 启动与旧页面运行时

`app.js` 在顶部自执行闭包中启动，直接查询旧 DOM、注册旧页面事件，并在末尾调用 `goPage('dashboard')`。它仍然负责旧 Dashboard、旧 Modal、导航以及多个旧页面的渲染。

证据：`app.js:5`、`app.js:1299`、`app.js:2260`、`app.js:3211`。

这意味着即使新 Life 页面是当前主界面，旧运行时仍然会加载并注册事件。CSS 隐藏旧 UI 不等于 JS 已经被移除。

### 1.2 状态初始化、迁移与本地持久化

`load()` 从 localStorage 读取状态，补默认值并兼容旧数据；`save()` 将完整状态写回 localStorage，并在已加入房间时调度云端写入。

证据：`app.js:387`、`app.js:450`。

目前状态初始化同时包含：

- `todos`
- `trainings`
- `messages`
- `gallery`
- `travels`
- `wishes`
- `meals`
- `hydrationLog`
- `water`
- `dailyStatus`
- `fortune`
- `challengeAnswers`
- `interactionHistory`
- `fitnessPlan`
- `settings.room`

因此，任何“清理旧字段”的动作都必须先经过迁移兼容审计。

### 1.3 领域数据 CRUD

`app.js` 直接实现或承载以下功能：

- 留言：新增、删除、文字与图片
- 相册：新增、删除、图片压缩、上传
- 心愿：新增、删除、点亮
- 待办：新增、编辑、完成切换、日历与 ICS 导出
- 训练：新增、编辑、删除、训练计划
- 喝水/饮料：旧 `water` 兼容、新 `hydrationLog` 记录与删除
- 旅行：新增、删除、图片与定位字段
- 抽签与星座：日期计算、抽签写入、运势渲染
- 每日状态与默契挑战

证据：

- 留言：`app.js:843-1055`
- 喝水/饮料：`app.js:1067-1175`
- 待办：`app.js:1413-1705`
- 星座/抽签：`app.js:1760-1867`
- 训练：`app.js:1886-2098`
- 旅行与新 Life 公共 API：`app.js:3211` 附近的 `addTravel`

### 1.4 同步客户端

`app.js` 内部实现完整的房间同步客户端：

- Worker / Supabase 兼容分支
- room GET / PUT
- 请求超时与取消
- 快照 hash
- 数组按 stable id 合并
- Durable Object revision / conflict 重试
- 自动轮询
- 写入队列与指数退避
- 防空房间、防大 payload、tombstone 清理
- 同步状态胶囊更新

证据：`app.js:2420-2968`、`app.js:2974-3177`。

### 1.5 图片与媒体

`compressRoomImage()` 负责客户端压缩，`storeRoomImage()` 将媒体上传到 Worker 的 `/media` 路由，并在状态中保留 URL 或兼容 data URL。

证据：`app.js:101-135`；调用方包括相册、留言、旅行和 Life 公共 API。

### 1.6 音乐

音乐库、按时段/天气/星期选歌、去重历史、喜欢/不喜欢、推荐渲染和定时刷新都在 `app.js` 中。

证据：`app.js:139-141`、`app.js:628-700`。

音乐状态使用 `state.settings._musicHistory`、`_musicLikes` 等设置字段保存，说明音乐推荐目前不是独立存储模块，而是核心状态的一部分。

### 1.7 推送与通知触发

`app.js` 负责通知状态、消息通知、Push 开关、测试通知入口，以及在 Service Worker 收到更新时触发轮询。

证据：`app.js:1181-1267`、`app.js:2337-2379`、`app.js:3200-3205`。

### 1.8 Presence、定位与房间管理

`app.js` 负责在线状态、最后在线时间、位置分享、距离计算请求、清理队列、房间创建/加入/退出/身份切换。

证据：`app.js:2132-2189`、`app.js:2974-3138`。

## 2. `life.js` 与 `app.js` 调用关系

当前调用关系如下：

```text
用户点击 Life DOM
        ↓
life.js 事件委托 / Bottom Sheet
        ↓
window.PufferLife.*
        ↓
app.js 状态修改函数
        ↓
save()
        ↓
localStorage + scheduleRoomPush()
        ↓
Worker / Durable Object / KV / D1
        ↓
puffer-state-change / puffer-presence-change
        ↓
life.js render()
```

`life.js` 不是通过 import 调用 `app.js`，而是依赖 `window.PufferLife` 全局适配层。公共 API 集中在 `app.js` 末尾，包含：

- `getState`
- `getWeather`
- `getTodayChallenge`
- `answerTodayChallenge`
- `isTodayInteractionComplete`
- `setDailyStatus`
- `addTodo` / `updateTodo` / `toggleTodo`
- `addMessage` / `addMessageFile`
- `addGalleryFile` / `deleteGallery`
- `addTravel` / `deleteTravel`
- `addHydration` / `deleteHydration`
- `drawFortuneNative`
- `setLocationSharing` / `refreshPresence`
- 房间配置、加入、退出、导入导出、立即同步

证据：`life.js:7`、`life.js:205-227`、`app.js:3211-3269`。

### 当前边界问题

`life.js` 虽然是 UI 层，但还直接承担：

- 今日参与完成判断
- 回顾范围与统计
- 旅行回忆选择
- 陪伴问候时间段判断
- localStorage 的一次性提示状态
- Push 点击后的页面路由
- 图片预览 object URL 生命周期

所以未来拆分时不能把它简单当作“纯视图文件”。

## 3. 状态管理入口

### 当前真实入口

| 入口 | 文件/位置 | 作用 |
|---|---|---|
| 状态对象 | `app.js` 闭包内 `state` | 当前页面与同步的内存状态 |
| 初次加载 | `app.js:387` `load()` | localStorage、默认值、旧字段兼容 |
| 本地保存 | `app.js:450` `save()` | localStorage 写入并调度同步 |
| 公开读取 | `app.js` 末尾 `PufferLife.getState()` | Life UI 读取同一状态 |
| 状态变更通知 | `puffer-state-change` 等自定义事件 | 触发 Life UI 重绘 |
| 浏览器多标签同步 | `app.js` storage listener | 读取其他标签写入的状态 |

### 当前风险

1. 状态写入入口不是单一函数：旧 UI 处理器、`window.PufferLife` 方法、同步合并路径都可能直接改变状态。
2. `save()` 既是本地持久化入口，又隐含同步调度入口，未来拆分时容易把 UI 操作与网络操作耦合在一起。
3. `life.js` 对 localStorage 有自己的提示、回顾、宠物位置和 AI 文案缓存，存在“核心状态之外的第二状态层”。
4. `water` 与 `hydrationLog` 并存；`meals` 也作为兼容字段继续参与快照，增加了状态审计成本。

## 4. 同步入口

### 浏览器端

主要入口：

- `scheduleRoomPush()`：延迟合并写入
- `pushToRoom()` / `pushToRoomOnce()`：先拉取、合并、再 PUT
- `pollRoom()` / `pollRoomOnce()`：约 3 秒轮询房间
- `roomGet()`：读取远端房间快照
- `roomPut()`：带 `baseRev`、作者、schemaVersion 的写入
- `mergeState()`：按数组 id、更新时间、删除标记合并
- `syncFetch()`：统一超时、`cache: no-store`

证据：`app.js:2420-2968`。

### 服务端

`shared-room-worker/worker.js` 的入口是 `fetch()` 和 `scheduled()`：

- Durable Object `RoomCoordinator` 处理房间版本与冲突
- KV `BENCH` 保存权威房间快照与元数据
- D1 保存可查询镜像、媒体元数据、Push 订阅和定时发送记录
- R2 保存私有媒体
- Worker PUT 后异步触发对端 Push

证据：`shared-room-worker/worker.js:502-649`、`shared-room-worker/worker.js:661-921`。

### 同步链路判断

当前同步设计有明显的“拉取后合并再写回”特征，留言、待办、相册、旅行等数组使用 `mergeArr()`，理论上比整份覆盖安全。需要特别保留的契约包括：

- stable `id`
- `createdAt` / `updatedAt`
- `deleted` tombstone
- `baseRev`
- payload hash
- 远端冲突重试

这些契约在未来拆分时不能因模块化而改变。

## 5. 图片 / 媒体入口

### 前端入口

1. `compressRoomImage(file)`：统一压缩入口，`app.js:101`。
2. `storeRoomImage(dataUrl)`：上传到 Worker，`app.js:120`。
3. `PufferLife.addMessageFile()`：留言图片。
4. `PufferLife.addGalleryFile()`：共同相册图片。
5. `PufferLife.addTravel()`：旅行记录图片。
6. `life.js` 的留言预览使用 `URL.createObjectURL()`，关闭 Sheet 时释放 object URL。

### Worker 入口

- 上传：`POST /api/v1/rooms/:room/media`
- 读取：`GET /api/v1/media/media/:uuid.jpg`
- R2 私有桶由 Worker 代理，不直接暴露桶地址
- D1 `media_objects` / `media_references` 用于生命周期与孤儿清理

证据：`shared-room-worker/worker.js:228-317`、`shared-room-worker/worker.js:666-670`、`shared-room-worker/worker.js:827-850`。

### 当前风险

- `dataUrl` 兼容路径与 R2 URL 路径并存，导致展示、压缩、同步和清理需要同时判断多种字段。
- 媒体上传成功后才写入业务数组，这个顺序是正确的，未来不能改成先写入不可访问的临时 URL。
- Worker 媒体引用清理依赖快照内容中的 URL 识别，任何新的媒体字段都需要同步更新 `mediaKeysInPayload()`。

## 6. 音乐模块位置和依赖

音乐模块完全位于 `app.js`，没有独立文件。

主要组成：

- 音乐库常量：`MUSIC_LIBRARY`、来源、歌曲 id、歌词/推荐信息
- 派生选择：`musicHash()`、`musicWeatherProfile()`、`musicWeekProfile()`
- 去重与偏好：`musicSettings()`、`pickMusicFor()`、`getMusicSlotSong()`
- 视图：`renderMusicWidget()`
- 反馈：`[data-music-feedback]` 点击处理
- 定时刷新：`startMusicSlotTimer()`，约 30 秒刷新

依赖：

- `state.settings` 中的音乐历史与喜欢状态
- 当前天气和日期/时段
- Life UI 通过 `PufferLife.getDailyMusic()` 读取两方歌曲
- 旧 Dashboard 仍可能由 `renderMusicWidget()` 直接渲染

证据：`app.js:628-700`、`app.js:3205` 附近的 `getDailyMusic()`。

建议未来把音乐拆成“纯选择器 + 状态适配器 + UI 适配器”，但暂时不要直接搬动，以免破坏两套 UI 的兼容调用。

## 7. 已删除功能残留：`training` 与 `meal`

### 7.1 `training`

结论：**不是确认 dead code，而是产品上已被旅行替代、代码上仍然可达的遗留功能。**

当前仍存在：

- 状态初始化与容量限制：`app.js:65-77`、`app.js:ROOM_ARRAY_LIMITS`
- 同步序列化、合并：`app.js:serializeRoom()`、`mergeState()`
- 旧训练页面：`app.js:1886-2098`
- `window.PufferLife.addTraining/updateTraining/deleteTraining`
- Life 路由：`life.js:206-207` 中的 `trainingSheet`、`data-life-training-*`
- 回顾统计：`life.js:202-203` 仍统计训练次数

因此现在删除会影响：旧页面、Life 路由、同步数据兼容、回顾页面以及已有历史记录。若最终产品确定不再支持训练，应该分成“只读迁移兼容”“停止新建”“再删除 UI”“最后删除代码”四步，不能一次搜索替换。

### 7.2 `meal`

结论：**旧饮食/喝水模型仍有残留，不能直接认定全部无用。**

当前仍存在：

- `defaultMeals()`、`dedupeMeals()`：`app.js:1067-1090`
- `state.meals` 初始化、兼容迁移
- 快照压缩与 `mergeState()` 合并
- 旧页面的饮食相关渲染/事件路径

新喝水功能主要使用 `hydrationLog`，但 `water` 和 `meals` 仍为兼容字段。建议后续先做数据覆盖率和生产快照审计，确认历史房间是否仍有 `meals`，再决定停止写入或做只读兼容。

## 8. Dead code 审计

### 已确认的“遗留运行时”

1. 旧 Dashboard / 旧 Modal / 旧页面初始化仍在 `app.js` 中执行，即使当前 Life UI 通过 CSS 或模式切换隐藏它们。
2. 训练旧页面与训练公共 API 仍被 Life 路由引用，属于遗留活路径，不是可安全删除的 dead code。
3. `meal` 兼容模型仍进入状态和同步 payload，属于遗留数据路径，不是可安全删除的 dead code。

### 可以列为待验证 dead code 的区域

以下区域本次只标记，不删除：

- 旧 Dashboard 专用 DOM 查询和事件处理：需要和 `index.html` 当前实际 DOM、`life-mode` 状态组合验证。
- Supabase 分支：当前产品默认 Worker，但 `roomActive()`、`roomGet()`、`roomPut()`、媒体与 Push 仍保留兼容分支；它是“低频兼容代码”，不能仅因不用就删除。
- 旧 `water` 数字格式兼容：新 `hydrationLog` 已是主要模型，但迁移函数仍可能处理历史数据。
- 旧训练计划与训练回顾：需要确认是否还有用户历史数据和入口。

### 本次没有证据支持直接删除的内容

- `window.PufferLife`
- `syncFetch` / `roomGet` / `roomPut` / `mergeState`
- Service Worker 更新与 Push 处理
- Worker 的 D1/R2/KV/DO 逻辑
- `dataUrl` 媒体兼容字段

## 9. 重复逻辑

| 重复点 | 位置 | 风险 |
|---|---|---|
| 页面渲染 | `app.js` 旧 Dashboard 与 `life.js` Life 页面 | 同一数据的两套展示规则可能不一致 |
| 弹窗系统 | `app.js` `openModal/closeModal` 与 `life.js` `openSheet/closeSheet` | 高度、遮罩、关闭、滚动行为容易分别修复 |
| 导航 | `app.js` 旧 `.nav-item/.bn-item` 与 `life.js` Life tab | 点击路由和当前页状态存在双入口 |
| 领域 CRUD | `app.js` 旧事件处理器与 `window.PufferLife` API | 同一领域可能绕过相同校验或提示 |
| 互动完成判断 | `app.js` `isTodayInteractionComplete/updateInteractionHistory` 与 `life.js` `participation/todayChallenge` | 完成态、连续天数、庆祝触发必须保持一致 |
| 通知 | `app.js` 页面通知、`push.js` 订阅、Service Worker 展示、Worker 发送 | “已订阅”与“已送达”容易被混为一谈 |
| 媒体展示 | data URL、R2 URL、消息图片字段、相册字段、旅行字段 | 某些页面可能漏判字段名或重复加载 |
| 状态缓存 | app.js 主状态、life.js localStorage 提示键、push.js localStorage 订阅键、Service Worker Cache | 清缓存/版本更新后的行为不完全一致 |
| 训练/饮食兼容 | 新 Life 功能与旧 app.js 模型并存 | 清理时容易误删历史数据兼容 |

## 10. 推荐未来模块拆分方案

以下是建议方案，不是本次执行内容。

### 阶段 0：先固定契约，不搬代码

先写测试和边界说明，固定：

- `PufferLife` 公共 API 形状
- 状态字段和默认值
- `save()` 的本地持久化语义
- `scheduleRoomPush()` 的触发语义
- `mergeArr()`、tombstone、revision、冲突重试
- 媒体字段和 R2 URL 规则
- Push 的订阅/发送/点击消息格式

### 阶段 1：提取纯函数，风险最低

建议先提取不直接碰 DOM、不直接发网络请求的内容：

```text
core/date.js
core/hash.js
core/limits.js
core/merge.js
core/derived.js
features/music/selector.js
features/interaction/completion.js
features/travel/derived.js
```

旧 `app.js` 通过兼容调用继续使用，先不改变数据结构。

### 阶段 2：提取存储与同步适配器

```text
core/state.js       load / normalize / save
core/local-store.js localStorage
core/room-sync.js   roomGet / roomPut / poll / push / retry
core/media.js       compress / upload / URL normalization
```

这一阶段必须保持 `window.PufferLife` API 不变，Life UI 不需要知道内部模块是否已经迁移。

### 阶段 3：提取领域服务

```text
features/todos.js
features/messages.js
features/gallery.js
features/hydration.js
features/travel.js
features/fortune.js
features/music.js
features/challenge.js
features/presence.js
```

每个模块只负责领域数据操作，统一调用 `state` 与 `save` 适配器，不能各自创建新的同步机制。

### 阶段 4：提取 Life UI

```text
ui/life-render.js
ui/life-sheets.js
ui/life-events.js
ui/companion.js
ui/reviews.js
```

此时 `life.js` 才逐步变成入口编排器，而不是同时包含渲染、统计、localStorage 和网络调用。

### 阶段 5：最后处理旧 UI

只有在真实页面回归、历史数据回归和两个设备同步回归都通过后，才考虑删除：

- 旧 Dashboard 渲染
- 旧训练 UI
- 旧 meal UI
- Supabase 兼容分支

这些应按单独提交处理，不能与核心同步模块拆分混在一起。

## 建议的优先级

### 现在就应保持的稳定资产

1. `window.PufferLife` 作为兼容门面。
2. `mergeArr`、revision、冲突重试和防空覆盖。
3. Worker 的 KV 权威快照、D1 镜像、R2 媒体与 Push 链路。
4. Service Worker 的脚本/样式更新策略和 Push 点击路由。

### 下一步只读工作

1. 为 `PufferLife` API 生成调用清单。
2. 为 `app.js` 的状态字段生成“写入点 / 读取点 / 同步点”表。
3. 为 `training`、`meal`、旧 Dashboard 生成生产数据覆盖率报告。
4. 为留言、图片、Push 做双设备时序测试。

### 暂不建议

- 立即把 `app.js` 拆成多个文件。
- 直接删除 `training` 或 `meal`。
- 把同步逻辑移到 `life.js`。
- 让每个领域模块自行调用 Worker。
- 修改 Worker API 或数据结构来配合前端重构。

## 最终判断

项目现在已经具备清晰的“核心运行时 + Life UI + Push 三段链路”，但还没有达到可以无风险拆模块的程度。最大的风险不在文件大小，而在以下边界尚未完全隔离：

```text
状态修改 ↔ 本地保存 ↔ 同步调度
旧 UI ↔ 新 Life UI
训练/meal 遗留数据 ↔ 新旅行/喝水功能
页面内提示 ↔ Web Push
```

因此本阶段的正确结果是：保留现状、记录边界、先做只读依赖和数据覆盖率审计，再从纯函数和适配器开始逐步迁移。

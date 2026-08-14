# JS Contracts

版本：2026-08-14  
用途：固定当前前端 API、状态、房间同步和 Push 行为，作为后续模块化的边界文档。  
本文件只描述现状，不改变任何运行时行为。

## 0. 不可破坏原则

- `window.PufferLife` 是 Life UI 与核心运行时之间的兼容门面。
- 所有用户数据先写入本地状态，再由 `save()` 触发 `puffer-state-change` 和房间同步调度。
- 房间数组使用稳定 `id`，并依赖 `createdAt`、`updatedAt`、`deleted` 进行合并。
- 房间写入必须经过 `serializeRoom()`、hash、`baseRev` 和 Worker revision。
- `training`、`meals`、`water` 是 legacy/兼容字段，本阶段不删除、不新增用途。
- 媒体优先通过 Worker 上传到 R2；data URL 只作为兼容展示和历史数据路径。
- Push 的“浏览器已订阅”“服务器已登记”“通知已发送”“通知已展示”是四个不同状态，不能合并成一个布尔值。

## 1. window.PufferLife 公共 API

实现位置：`app.js` 末尾 `window.PufferLife = { ... }`。主要调用方：`life.js`。

| API | 参数 | 返回值/效果 | 主要调用方 | 长期建议 |
|---|---|---|---|---|
| `getState()` | 无 | 返回深拷贝的公开状态快照 | Life 全部渲染 | 保留，作为只读快照 |
| `open(page)` | 页面名 | 调用旧 `goPage()` | 兼容入口 | 保留兼容 |
| `getHoroscopes()` | 无 | 双星座元数据与当日运势 | 星座页 | 保留 |
| `getDailyMusic()` | 无 | `netease` 与 `apple` 歌曲对象 | 首页音乐 | 保留，未来只替换实现 |
| `getPresence()` | 无 | 在线、最后在线、位置、距离 | Presence UI | 保留 |
| `refreshPresence()` | 无 | 发起在线/位置刷新，返回 true | Presence Sheet | 保留 |
| `setLocationSharing(enabled)` | boolean | 开关位置分享，可能为异步结果 | Presence Sheet | 保留 |
| `getTodayChallenge()` | 无 | 当日题目和双方回答状态 | 默契 Sheet | 保留 |
| `answerTodayChallenge(answer)` | option id | 首次成功 true，重复回答 false | 默契 Sheet | 保留，不能用文案作 key |
| `isTodayInteractionComplete()` | 无 | 今日互动与默契是否全部完成 | 完成态、庆祝、连续互动 | 作为唯一完成判断 |
| `setDailyStatus(person,mood,text)` | 成员、心情、文字 | 保存当日状态，成功 true | 心情 Sheet | 保留 |
| `addTodo(input)` | text/date/priority | 新增待办 | 待办 UI | 保留 |
| `updateTodo(id,input)` | id 与字段 | 更新待办 | 待办 UI | 保留 |
| `toggleTodo(id)` | 待办 id | 切换完成状态 | 首页/日子 | 保留 |
| `addTraining/updateTraining/deleteTraining` | 训练字段/id | 训练 CRUD | 旧训练与遗留 Life 入口 | legacy，暂不删除 |
| `updateFitnessPlan(plan)` | 周计划对象 | 更新旧训练计划 | 旧训练 UI | legacy |
| `addWish(input)` | 文字、图标 | 新增心愿 | 心愿页 | 保留 |
| `deleteWish(id)` / `lightWish(id)` | 心愿 id | 软删除/点亮 | 心愿页 | 保留 |
| `addMessage(text)` | 文字 | 新增留言 | 留言页 | 保留 |
| `addMessageFile(file,text)` | 图片、文字 | 压缩上传并新增图片留言，Promise | 留言页 | 保留，必须走统一媒体入口 |
| `deleteMessage(id)` | 留言 id | 软删除 | 留言页 | 保留 |
| `addGalleryFile(file,caption)` | 文件、说明 | 压缩上传并新增照片，Promise | 相册页 | 保留 |
| `addGalleryUrl(url,caption)` | URL、说明 | 新增外链照片 | 兼容入口 | 保留兼容 |
| `deleteGallery(id)` | 相片 id | 软删除 | 相册页 | 保留 |
| `addTravel(input,file)` / `deleteTravel(id)` | 旅行字段/图片/id | 旅行 CRUD，图片时 Promise | 旅行页 | 保留 |
| `addWater(delta)` | 毫升增量 | 旧 water 模型记录 | 旧 UI | legacy 兼容 |
| `getHydrationToday()` | 无 | 本人/TA 水饮料统计与记录 | 喝水页 | 保留 |
| `addHydration(kind,ml)` / `deleteHydration(id)` | 类型、毫升/id | 新增或软删除喝水/饮料 | 喝水页 | 保留 |
| `drawFortuneNative()` | 无 | 写入当前成员今日抽签 | 抽签页 | 保留 |
| `setIdentity(me)` | a/b | 切换身份并处理房间上下文 | 设置页 | 保留 |
| `setNotifySystem(on)` | boolean | 保存页面通知开关并请求权限 | 设置页 | 保留，不等同 Web Push |
| `updateProfile(input)` | 成员名、城市 | 更新资料，可刷新天气 | 设置页 | 保留 |
| `syncNow()` | 无 | 主动执行房间同步 | 同步页 | 保留 |
| `configureRoom(input)` | backend/url/anon/id/pass | 配置未加入的房间 | 设置页 | 保留兼容 |
| `joinConfiguredRoom(create)` / `leaveConfiguredRoom()` | boolean/无 | 加入、创建或退出房间，Promise | 设置页 | 保留 |
| `exportBackup()` / `importBackup()` | 无 | 导出/导入脱敏备份 | 设置页 | 保留 |
| `exportTodos()` | 无 | 导出有日期待办为 ICS | 旧待办页 | 保留兼容 |

API 约束：Life 不直接修改 `getState()` 返回值，不自行写 localStorage，不自行调用房间 Worker；新媒体必须走统一压缩和上传入口。

## 2. 当前 state 字段契约

定义位置：`app.js` 的 state 初始化和 `load()` 兼容恢复逻辑。

| 字段 | 类型 | 进入同步 | 当前用途 | 标记 |
|---|---|---|---|---|
| `todos` | Array | 是 | 待办、完成、日历 | active |
| `fitnessPlan` | 对象 | 是 | 旧训练计划 | legacy |
| `trainings` | Array | 是 | 训练记录、回顾统计 | legacy，但仍可达 |
| `messages` | Array | 是 | 留言、图片留言 | active |
| `gallery` | Array | 是 | 共同相册 | active |
| `travels` | Array | 是 | 旅行时间线、回顾 | active |
| `meals` | Array | 是 | 旧饮食/菜单兼容 | legacy |
| `wishes` | Array | 是 | 心愿便利贴 | active |
| `water` | 日期对象 | 是 | 旧水量兼容 | legacy |
| `hydrationLog` | Array | 是 | 新水/饮料逐条记录 | active |
| `dailyStatus` | 日期 → 成员 | 是 | 两人当日状态 | active |
| `interactionHistory` | 日期对象 | 是 | 完成态、连续互动 | active/派生 |
| `challengeAnswers` | Array | 是 | 今日默契回答 | active |
| `fortune` | 日期 + by.a/by.b | 是 | 双人抽签 | active |
| `settings.partners` | 成员对象 | 是 | 房间显示名 | active |
| `settings.me` | a/b | 否 | 当前身份 | local |
| `settings.city` | 字符串 | 否 | 天气城市 | local |
| `settings.room` | 房间对象 | 否 | URL、房间号、口令、revision | local |
| `settings.syncCode/cloudUrl` | 字符串 | 否/兼容 | 旧同步入口 | legacy/local |
| `_weather` | 对象 | 否 | 天气缓存 | cache |

同步数组中的记录应保持 `id`、`author`（适用时）、`createdAt`、`updatedAt`、`deleted`。

## 3. 房间同步契约

### 3.1 serializeRoom

当前快照包含：

`todos`、`trainings`、`messages`、`gallery`、`travels`、`meals`、`wishes`、`water`、`hydrationLog`、`challengeAnswers`、`dailyStatus`、`interactionHistory`、`fortune`、`partners`、`fitnessPlan`、`syncedAt`。

`trainings`、`meals`、`fitnessPlan` 和旧 `water` 暂时保留用于兼容。数组只在同步 payload 层限额和清理 tombstone，本地状态不应被物理截断。

当前 payload 约束：

- 数组上限：todos 500、trainings 300、messages 300、gallery 60、travels 300、meals 300、wishes 200、hydrationLog 1200、challengeAnswers 800。
- tombstone 保留约 90 天。
- 旧水量日期约保留 180 天；daily status 约保留 400 天。
- 整体快照上限 8 MB。

### 3.2 mergeState / mergeArr

- `mergeArr(local,remote)` 按稳定 id 合并；删除标记优先；否则以 updatedAt/createdAt 较新者为准；同时间戳用稳定序列化结果打破平局。
- `mergeDailyStatus()` 按日期、成员分别比较更新时间。
- `mergeInteractionHistory()` 按完成时间保留较新记录。
- `mergeFortune()` 按日期和成员分别比较抽签时间。
- `mergePlan()` 按星期键和更新时间合并训练计划。
- `water` 按日期、成员取较大值，兼容旧数字结构。

### 3.3 revision 与防空覆盖

写入链路：

```text
save()
  → scheduleRoomPush()
  → pushToRoomOnce()
  → roomGet()
  → mergeState()
  → serializeRoom()
  → snapshotHash()
  → roomPut(baseRev)
  → Durable Object / Worker revision
```

约束：

- PUT 携带 `baseRev`；冲突时重新拉取、合并、重试。
- 拉取失败时本地数据保留，进入自动退避重试。
- Worker 负责口令、revision 和权威快照提交；前端负责按记录合并。
- 不允许空或明显不完整的本地快照覆盖已有房间。
- D1 是可查询镜像，不是当前写入权威源；KV/DO 承担权威协同职责。

## 4. Push 契约

### 4.1 push.js

负责：获取/创建 Push subscription、请求通知权限、获取 VAPID public key、登记/取消服务器订阅、查询浏览器与服务器订阅状态。

主要 API：`enable()`、`disable()`、`endpoint()`、`status()`、`removeServer()`。

它不负责定时判断，也不负责绘制通知。

### 4.2 service-worker.js

负责：PWA 缓存与更新优先策略、接收 `push` 事件、展示通知、向页面发送更新消息、点击通知后聚焦已有窗口或打开目标 URL。

页面事件：

```text
puffer-room-update
puffer-open-notification
```

### 4.3 Worker

主要 Push API：

```text
GET  /api/v1/push/public-key
POST /api/v1/rooms/:room/push/subscribe
POST /api/v1/rooms/:room/push/unsubscribe
POST /api/v1/rooms/:room/push/status
POST /api/v1/rooms/:room/push/test
```

Worker 使用 D1 保存 `push_subscriptions`；房间 PUT 后通过 `pushChanges()` 判断 messages/gallery/todos 的新增；`scheduled()` 负责定时提醒；`scheduled_pushes` 防止同一房间、成员、日期、时段重复发送；失效 endpoint 返回 404/410 时清理。

当前变化通知 kind 主要是：

```text
messages
gallery
todos
```

定时提醒还会使用 `reminder`、`hydration`、`greeting` 等 kind。通知目标通过 `?open=` 和 Service Worker 页面消息进入 Life 页面。

## 5. life.js 实际依赖

### 读取

`getState`、`getWeather`、`getHoroscopes`、`getDailyMusic`、`getPresence`、`getHydrationToday`、`getTodayChallenge`、`isTodayInteractionComplete`。

### 写入

- 状态：`setDailyStatus`
- 默契：`answerTodayChallenge`
- 待办：`addTodo/updateTodo/toggleTodo`
- 留言：`addMessage/addMessageFile/deleteMessage`
- 相册：`addGalleryFile/deleteGallery`
- 旅行：`addTravel/deleteTravel`
- 喝水：`addHydration/deleteHydration`
- 心愿：`addWish/lightWish/deleteWish`
- 抽签：`drawFortuneNative`
- Presence：`setLocationSharing/refreshPresence`
- 设置与同步：`updateProfile/setIdentity/syncNow/configureRoom/joinConfiguredRoom/leaveConfiguredRoom`

### Life 自己持有的临时状态

当前 tab、Bottom Sheet、日历游标、喝水查看对象、陪伴浮窗位置、提示/回顾已读 key、AI 问候缓存、图片预览 object URL。这些不是房间同步字段，未来要与业务 state 继续分开。

## 6. 后续模块化不可破坏接口

### 核心

```text
window.PufferLife.getState()
window.PufferLife.isTodayInteractionComplete()
window.PufferLife.syncNow()
window.PufferLife.getHydrationToday()
window.PufferLife.getDailyMusic()
```

### 数据写入

```text
add/update/toggleTodo
addMessage / addMessageFile / deleteMessage
addGalleryFile / addGalleryUrl / deleteGallery
addTravel / deleteTravel
addHydration / deleteHydration
setDailyStatus
answerTodayChallenge
drawFortuneNative
```

### 同步内部语义

```text
serializeRoom()
mergeState()
mergeArr()
roomGet()
roomPut()
scheduleRoomPush()
pushToRoom()
pollRoom()
```

这些函数未来可以换文件，但字段、错误语义、revision 和合并策略不能改变。

### 事件

```text
puffer-state-change
puffer-presence-change
puffer-life-home
puffer-life-messages
puffer-life-todo
puffer-life-gallery
puffer-life-hydration
puffer-push-ready
puffer-room-update
puffer-open-notification
```

新模块不要复用旧事件名表达不同含义；新增事件应记录触发方、载荷和接收方。

## 7. 推荐拆分顺序

本阶段只固化契约，后续建议：

1. 先提取纯函数：日期、hash、数组合并、完成判断、音乐选曲。
2. 再提取 state/localStorage 适配器，但保持 `window.PufferLife` 不变。
3. 再提取媒体上传适配器，保留 data URL 与 R2 URL 兼容。
4. 以音乐作为第一个业务模块试点：先抽选曲逻辑，最后抽 UI。
5. 再拆 hydration、travel、todo 等领域服务。
6. 最后才处理旧 Dashboard、training、meal 和 Supabase 兼容分支。

## 8. 验收结论

本阶段完成：API、state、同步、revision、防空覆盖、Push 三段链路、事件名和 Life 依赖均已记录；没有修改 JavaScript、CSS、Worker 或数据结构。

下一步如果开始音乐模块化，应先做音乐调用点和状态字段的只读审计，再单独提交。

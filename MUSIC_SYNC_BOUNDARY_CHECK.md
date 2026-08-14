# 音乐模块部署前同步边界检查

检查日期：2026-08-14

## 结论

音乐推荐目前属于个人设备状态，不会进入情侣房间同步，也不会被同步 Worker 处理。首页音乐改造没有新增房间字段，满足当前“个人推荐、不共享偏好”的设计边界。

## 检查结果

### 1. 音乐状态存储位置

`features/music/music-state.js` 将音乐状态写入现有本地 `state.settings`，使用以下私有字段：

- `_musicHistory`
- `_musicLikes`
- `_musicRejectedForSlot`
- `_musicBlocked`
- `_musicSlotSongKeys`
- `_musicCurrentMusic`
- `_musicDayHistory`
- `_musicNotifiedSlot`

这些字段由现有本地保存流程持久化，但没有作为房间同步 payload 输出。

### 2. 推荐模块是否读取共享状态

`music-recommend.js` 通过 `MusicState.getSettings()` 读取个人音乐设置、历史和反馈；它使用天气等当前设备上下文计算推荐，不读取远端房间快照中的音乐字段。

### 3. 视图模块依赖

`features/music/music-view.js` 只调用：

- `PufferMusicRecommend.getCurrentMusic()`
- `PufferMusicRecommend.currentMusicSlot()`
- `PufferMusicState.getDayMusicHistory()`

视图不调用 Worker、房间 API、`serializeRoom()` 或 `mergeState()`。

### 4. 房间同步 payload

`app.js` 的 `serializeRoom()` 当前输出待办、训练、留言、相册、旅行、心愿、饮水、默契、状态、互动历史、抽签、成员资料和训练计划等共享字段。

检查结果：没有 `music`、`todayMusic`、`_music*` 或音乐推荐字段。

### 5. 房间合并逻辑

`mergeState()` 当前合并的是共享业务数组和状态字段，没有音乐字段，也没有调用音乐模块的合并方法。

检查结果：音乐个人偏好不会被另一台设备覆盖，音乐历史不会参与 `mergeArr()`。

### 6. Worker 检查

`shared-room-worker/worker.js` 中没有音乐字段、音乐事件或音乐持久化逻辑。Worker 继续只处理房间快照、推送、Presence、媒体和 D1 镜像等既有职责。

## 双设备预期行为

| 操作 | 设备 A | 设备 B |
|---|---|---|
| 生成当前推荐 | 只影响 A 的本地推荐 | 不会被改写 |
| 喜欢/跳过/屏蔽 | 只记录在 A | 不同步 |
| 音乐历史 | 只保留在 A | 不同步 |
| 房间同步 | 不携带音乐字段 | 不会收到 A 的个人音乐状态 |

## 发布前注意事项

本次音乐改造没有修改 Worker 或房间数据结构，可以继续使用现有 Cloudflare Pages 发布流程。发布后建议在两台设备分别打开首页，确认各自显示“此刻推荐”，并确认房间同步仍能正常接收留言、待办和照片。


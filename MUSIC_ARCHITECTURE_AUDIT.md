# MUSIC_ARCHITECTURE_AUDIT

审计日期：2026-08-14
审计范围：app.js、life.js、index.html、life-dashboard-music.css，并核对房间同步与 Push Worker。
审计性质：只读分析。本次没有修改 JS、CSS、Worker 或数据结构。

## 结论摘要

当前音乐功能是一个完整但仍内嵌在 app.js 的模块，life.js 只通过 window.PufferLife.getDailyMusic() 读取推荐结果，并通过点击事件打开旧的音乐浮窗。

当前不是“共享音乐状态”模型，而是：

- 歌曲库和推荐规则写在前端代码中。
- 每台设备根据本地时间、天气、星期和本地偏好自行计算。
- 网易云侧与 Apple Music/相似推荐侧按来源过滤。
- 推荐历史、喜欢、不喜欢、屏蔽和时段固定歌曲保存在当前设备的 state.settings._music* 字段。
- 音乐字段没有进入 serializeRoom()，也没有通过房间同步到另一台设备。

因此当前产品语义是：首页同时展示“我的网易云推荐”和“TA 的 Apple Music/相似风格推荐”，但推荐状态本身是个人设备状态，不是房间共享记录。

## 1. 音乐相关代码位置

| 文件 | 位置/入口 | 职责 |
|---|---|---|
| app.js | 139-248 | Apple Music、网易云、相似推荐歌曲库、链接和歌词 |
| app.js | 622-665 | 时段、天气、星期、去重、排序和选曲 |
| app.js | 666-700 | 旧音乐浮窗渲染、喜欢/换一首/不再推荐、30 秒定时 |
| app.js | 3151-3165 | 音乐唱片浮窗打开/关闭和首次渲染 |
| app.js | 3233 附近 | PufferLife.getDailyMusic() 公共读取接口 |
| life.js | 125、206 | 首页音乐卡片读取；点击卡片打开音乐浮窗 |
| index.html | 568-580 | 音乐浮窗 DOM、歌曲列表容器、平台链接 |
| life-dashboard-music.css | 全文件 | 音乐浮窗的独立样式 |
| shared-room-worker/worker.js | Push 变更检测 | 没有音乐字段专用同步或 Push |

## 2. 当前音乐数据结构

### 2.1 静态歌曲记录

歌曲库中的单曲大致采用：

    {
      title: '歌曲名',
      artist: '歌手',
      id: 'Apple Music id 或空字符串',
      tags: ['morning', 'rain', 'soft'],
      source: '你们的 Apple Music 歌单',
      url: '外部歌曲/搜索链接'
    }

来源目前包括：

- 你们的 Apple Music 歌单
- 你们的网易云歌单
- 相似推荐

歌曲库在 app.js 中静态定义，不从网易云、Apple Music 或 Worker 动态拉取。

### 2.2 本地音乐偏好与缓存字段

音乐状态写入 state.settings，主要字段包括：

    _musicHistory
    _musicLikes
    _musicSlotSongKeys
    _musicRejectedForSlot
    _musicBlocked
    _musicNotifiedSlot

语义：

- _musicHistory：近期推荐历史，按时间清理并限制数量。
- _musicLikes：歌曲 key → 喜欢/不喜欢状态。
- _musicSlotSongKeys：日期 + 时段 + 来源过滤 → 固定歌曲 key。
- _musicRejectedForSlot：当前时段拒绝的歌曲。
- _musicBlocked：永久不再推荐的歌曲。
- _musicNotifiedSlot：当前设备已提示过的时段。

歌曲稳定 key 由来源、歌曲 id 或“歌手 + 歌名”组成。形式为 source + ':' + (id || artist + ':' + title)。

### 2.3 对外返回结构

getDailyMusic() 当前返回：

    {
      netease: songObject | null,
      apple: songObject | null
    }

它不是一个带日期、时段、理由和来源的同步记录对象。

## 3. 当前音乐 UI

### 3.1 Life 首页

life.js 从 getDailyMusic() 读取：

- music.netease：显示“我 · 网易云”
- music.apple：显示“TA · Apple Music”
- 每张卡显示歌名和歌手
- 点击 data-life-music 后打开音乐浮窗

Life 首页自身不负责选曲，也不负责保存音乐偏好。

### 3.2 旧音乐浮窗

index.html 中的 #musicFloat 包含：

- 唱片按钮
- #musicFloatPanel
- #musicList
- 当前时段问候
- 推荐理由
- Apple Music 与网易云歌单链接

app.js 的 renderMusicWidget() 直接拼接浮窗 HTML，歌曲条目包含：

- 歌名、歌手、来源
- 一句歌词或默认陪伴文案
- 喜欢、换一首、不再推荐
- 外部跳转链接

### 3.3 样式

音乐浮窗样式已经单独位于 life-dashboard-music.css。这说明 CSS 层面已有独立边界，但 JS 仍嵌在 app.js，不能仅凭 CSS 文件独立就认为音乐已模块化。

## 4. 当前推荐和刷新逻辑

### 4.1 输入

推荐逻辑使用：

- 当前时段：早上 11 点前、白天 11-18 点、晚上 18 点后
- 天气 profile：晴、云、雨等
- 星期 profile：工作日、周末、星期五等
- 来源过滤：网易云、Apple Music、相似推荐
- 本地最近推荐历史
- 本地喜欢/不喜欢/屏蔽状态

### 4.2 选曲

pickMusicFor(part, excluded, sourceFilter)：

1. 根据天气、星期和时段生成目标标签。
2. 根据来源筛选歌曲。
3. 排除对方来源同名歌曲，避免网易云/Apple Music 交叉错推。
4. 按标签匹配、相似推荐加分、近期历史扣分、喜欢加分、不喜欢扣分。
5. 用稳定 hash 加入小幅随机因子。
6. 取分数最高的歌曲。

### 4.3 一天内固定

getMusicSlotSong() 以“今天日期 + 当前时段 + 来源过滤”作为 slot key。已存在时复用；“换一首”会清理相关 slot 缓存后重新选曲。刷新页面不会因普通随机数而直接变歌。

### 4.4 自动刷新

- 天气成功或使用缓存时重新渲染音乐。
- 音乐浮窗初始化时渲染并检查一次时段提示。
- startMusicSlotTimer() 每 30 秒重新渲染并检查时段推荐提示。
- _musicNotifiedSlot 限制当前设备每个时段一次。

这不是后台 Push。页面没有打开时，音乐模块本身不会由前端定时器主动执行。

## 5. 音乐保存和同步边界

### 5.1 本地保存

音乐偏好通过 save({silent:true}) 写入 localStorage。由于位于 state.settings，音乐状态会被当前设备保留。

### 5.2 是否进入 room sync

serializeRoom() 不包含：

- _musicHistory
- _musicLikes
- _musicSlotSongKeys
- _musicRejectedForSlot
- _musicBlocked
- _musicNotifiedSlot

getDailyMusic() 也不读取远端房间字段。

所以：

- A 端喜欢某首歌，B 端不会同步这个喜欢状态。
- A 端点“不再推荐”，B 端仍可能推荐。
- A 端“换一首”，B 端不会跟着换。
- 两台设备可能看到相同静态库歌曲，但不保证推荐偏好一致。
- 音乐推荐不是房间冲突合并的一部分，也不会触发音乐 Push。

### 5.3 当前属于共享还是个人

| 内容 | 当前归属 | 建议长期归属 |
|---|---|---|
| 歌曲静态库 | 前端公共代码 | 公共只读配置 |
| 当日自动推荐结果 | 每台设备本地计算 | 可继续个人推荐；共享展示时再存轻量结果 |
| 我的网易云来源选择 | “我”的个人推荐 | 个人推荐 |
| TA 的 Apple Music/相似来源选择 | “TA”的展示推荐 | 个人推荐 |
| 喜欢/换一首/不再推荐 | 当前设备本地 | 个人偏好 |
| 今天我们一起听的歌 | 当前不存在 | 未来新增的共享记录 |
| 推荐理由 | 本地计算 | 展示缓存，不宜直接作为核心数据 |

结论：当前不应把个人推荐偏好直接塞入 room state。若未来要做共享音乐，应新增明确的 shared music record，而不是同步 _music* 临时偏好字段。

## 6. 与 app.js / life.js 的依赖关系

当前调用链：

    app.js 静态 MUSIC_LIBRARY
      ↓
    musicWeatherProfile / musicWeekProfile
      ↓
    pickMusicFor / getMusicSlotSong
      ↓
    renderMusicWidget（旧浮窗）
      ↓
    PufferLife.getDailyMusic()
      ↓
    life.js 首页音乐卡片

反馈链：

    life.js 点击音乐卡片
      ↓
    #musicFloatToggle.click()
      ↓
    app.js 浮窗展示
      ↓
    data-music-feedback 事件
      ↓
    修改 state.settings._music*
      ↓
    save({silent:true})
      ↓
    重新 renderMusicWidget()

当前强依赖：

- state.settings
- state._weather
- todayKey()
- save()
- #musicList、#musicFloatToggle
- MUSIC_DAYPARTS、MUSIC_LIBRARY、MUSIC_LYRICS

## 7. 不可破坏接口

后续音乐重构必须保持：

1. window.PufferLife.getDailyMusic() 的调用方式。
2. 返回至少包含 netease 和 apple 两个可空歌曲对象。
3. 歌曲对象继续提供 title、artist、source、url；有 id 时保留 id。
4. 歌曲 key 的稳定性，不能因改文案导致历史偏好全部失效。
5. 网易云推荐不能误用 Apple Music 歌曲。
6. 同一天、同一时段、同一来源默认保持稳定。
7. 喜欢、换一首、不再推荐的现有语义。
8. 不把音乐偏好写入房间同步，除非明确设计新的共享字段。
9. 不让音乐刷新触发房间写入或冲突重试。
10. 音乐失败不能影响首页、同步和其他功能。

## 8. 未来拆分建议

### 第一步：只提取纯数据

建议文件：features/music/music-data.js

内容：

- MUSIC_LIBRARY
- MUSIC_LYRICS
- MUSIC_DAYPARTS
- Apple/网易云歌单 URL
- source/id/url 数据规范

第一步不改变 PufferLife，也不改变 state。

### 第二步：提取纯推荐函数

建议文件：features/music/music-recommend.js

输入：date、part、weather、week、sourceFilter、history、likes、rejected、blocked。

输出：song object。

函数应尽量纯，不直接读 DOM、不直接写 localStorage、不直接调用 Worker。

### 第三步：提取个人音乐状态适配器

建议文件：features/music/music-preferences.js

只负责读取/初始化 state.settings._music*，保存喜欢、不喜欢、屏蔽、slot 固定结果，保持现有字段兼容。

### 第四步：提取展示适配器

建议文件：features/music/music-view.js

负责旧音乐浮窗 HTML、Life 首页卡片所需展示数据和反馈按钮事件。Life.js 最终只拿展示数据和绑定事件，不再知道选曲细节。

### 第五步：再决定共享音乐

如果以后要做“你们今天一起听什么”，建议单独设计 sharedMusic：

    {
      date: 'YYYY-MM-DD',
      slots: {
        morning: { songKey, title, artist, source, url },
        noon: { songKey, title, artist, source, url },
        night: { songKey, title, artist, source, url }
      },
      source: 'system',
      updatedAt: 0
    }

这是新产品能力，不应在本次模块化里顺手加入，也不应把 _music* 直接同步。

## 9. 当前问题与风险

已确认：

- 音乐逻辑集中在 app.js，文件职责过重。
- Life 首页依赖旧音乐浮窗，存在新旧 UI 耦合。
- 音乐个人偏好保存在通用 settings，没有专门适配层。
- 音乐结果不进入房间同步，双端的换一首/喜欢/不再推荐不会一致。
- 页面内 30 秒定时器不是后台通知机制。

需要后续验证：

- 所有 Apple Music id、网易云链接和歌手字段是否准确。
- 是否仍有旧页面直接读取音乐字段。
- 同一歌曲 key 在历史数据中是否因 id 空缺而变化。
- PWA 切换时段后是否按预期更新浮窗和首页卡片。
- 个人推荐偏好是否需要跨设备同步。

## 10. 产品建议

第一版不建议把音乐改成完整共享状态，因为这会把本地偏好、房间同步、冲突合并和 Push 绑定在一起。

更稳妥的路线：

1. 保持“我看网易云、TA 看 Apple Music/相似风格”。
2. 先分离数据、推荐和 UI，不改字段。
3. 先修正歌曲来源、id、歌手和相似推荐准确性。
4. 后续新增“今天一起听”的轻量共享记录。
5. 共享记录和个人推荐分开：共享最终选择，个人偏好继续本地保存。

## 最终判断

音乐适合作为第一个模块化试点，但第一步应是纯函数和适配层拆分，不应先改同步或数据结构。

推荐顺序：

音乐只读审计 → 确认歌曲数据与来源 → 提取 music-data → 提取 music-recommend → 提取 music-preferences → 提取 music-view → 最后讨论 sharedMusic。

本审计没有修改任何 JS、CSS、Worker 或数据结构。

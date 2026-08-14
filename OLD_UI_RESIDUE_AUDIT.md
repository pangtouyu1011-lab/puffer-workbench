# 新版页面启动后的旧 UI 残留审计

审计日期：2026-08-14
审计范围：`index.html`、`app.js`、`life.js`、当前页面 CSS  旧版启动路径、训练/饮食 legacy 数据路径、横向溢出风险
审计方式：只读扫描与生产环境启动复验

## 结论摘要

当前没有复现最新生产版本的启动崩溃。最近一次生产环境复验结果为：

```text
life=ok music=button track=ok fallback=no
```

因此，截图中的空白页和布局异常不应再归因于音乐轨迹本身；更可能是旧 PWA 缓存、旧部署版本，或旧 UI 结构在某条路径下被重新显示。

但项目中仍然存在确定的旧 UI 残留：

1. `index.html` 仍保留完整旧 Dashboard、旧底部导航和旧训练页面 DOM，只是在 `life-boot` 模式下隐藏。
2. `app.js` 仍保留旧 Dashboard、训练、饮食的渲染、同步、备份和公开 API 兼容逻辑。
3. `life.js` 已经负责新版 Life UI，但仍保留训练相关 Bottom Sheet 兼容入口；新旧运行时代码仍同时加载。
4. `styles.css` 仍包含旧 Dashboard、旧训练和旧导航样式。它们目前主要被隐藏或隔离，但会增加选择器冲突和布局污染风险。
5. `index.html` 中存在编码损坏的 legacy 文本/标记片段。它们多数位于旧隐藏区域，但如果旧壳被显示、字符串被拼接或缓存命中旧版本，就可能表现为 `</span>`、`</div>` 等内容泄露。

## 优先级判断

| 优先级 | 问题 | 当前状态 | 建议 |
|---|---|---|---|
| P0 | 新版页面启动失败 | 最新生产复验未复现 | 若再次出现，先记录实际版本、清理 PWA 缓存并抓取控制台错误 |
| P1 | 旧 HTML 与新版 Life DOM 共存 | 已确认 | 后续完成迁移清单后删除旧 DOM；本次不直接删除 |
| P1 | legacy HTML 中存在损坏编码/疑似标记泄露片段 | 已确认 | 在删除旧 DOM 前先修复或隔离；增加 HTML 结构检查 |
| P2 | `app.js` 仍维护训练、饮食和旧 Dashboard | 已确认 | 保留兼容，待 schema 迁移方案后再退休 |
| P2 | 旧 CSS 仍加载 | 已确认 | 等旧 DOM 引用归零后再移除，避免当前页面回归 |
| P3 | 新旧入口同时加载造成维护复杂度 | 已确认 | 后续以 Life UI 为唯一启动入口，逐步收缩旧兼容层 |

## 1. `index.html` 审计

### 1.1 旧页面 DOM 仍存在

已确认以下旧结构仍在文档中：

- 旧 Dashboard：`index.html:304`，`id="page-dashboard"`
- 旧 Dashboard 训练统计：`index.html:342-343`，`statTrain`、`statTrainSub`
- 旧 Dashboard 训练区块：`index.html:398`，`dashTrain`
- 旧训练页面：`index.html:460`，`id="page-fitness"`
- 旧训练新增入口：`index.html:468`，`addTrainBtn`
- 旧训练日期导航和列表：`index.html:490-497`，`trainPrev`、`trainToday`、`trainNext`、`trainSelDate`、`trainSummary`、`trainList`
- 旧底部导航：`index.html:547`，`class="bottom-nav"`
- 旧导航中的训练入口：`index.html:276`，`data-page="fitness"`

这些不是单纯的无效文本，而是完整旧页面。当前 `life-boot` 样式会隐藏 `.app` 和 `.bottom-nav`，所以它们通常不应可见；但它们仍会被脚本查询、绑定和渲染。

### 1.2 损坏编码/标记片段

扫描发现以下 legacy HTML 片段存在编码损坏或疑似标记被当作文本的风险：

- `index.html:396`：`去记�?�?/button>`
- `index.html:468`：`�?记录训练`
- `index.html:490`：标题中出现 `前一�?>�?/button>`
- `index.html:492`：标题中出现 `后一�?>�?/button>`

这些片段大多位于旧隐藏页面，因此不能单凭静态扫描断言它们就是当前线上截图的直接来源；但它们确实是 HTML 泄露的高风险源。若旧壳被意外显示，或某段旧模板被重新插入页面，浏览器可能显示这些损坏字符或残留标签。

### 1.3 旧 CSS 引用

`index.html` 仍加载 `life-dashboard.css` 和 `life-dashboard-music.css`。这两个文件包含当前 Life 页面仍可能使用的部分组件，因此本次不能安全判定为“可直接删除”。应在旧 DOM 清理和引用关系审计完成后再处理。

## 2. `app.js` 审计

### 2.1 旧 Dashboard 仍有完整渲染路径

- `app.js:1160`：`renderDashboard()`
- `app.js:1188-1208`：旧 Dashboard 训练统计和训练卡片渲染
- `app.js:449-456`：`goPage()` 仍可能调用 `renderDashboard()` 或 `renderFitness()`
- `app.js:2832`：存在 `else renderDashboard()` 回退路径

最新修复已在 `app.js` 底部增加 `life-boot` 判断，避免页面启动时无条件执行旧 Dashboard：

```js
if (!document.documentElement.classList.contains('life-boot')) goPage('dashboard');
```

这解释了为什么最新生产复验已恢复正常；但它只是阻止默认启动，不是删除旧运行时。

### 2.2 训练逻辑仍存在

- `app.js:1735`：训练选择状态
- `app.js:1747`：`renderFitness()`
- `app.js:1750-1831`：旧训练页面渲染
- `app.js:1838`：`openTrainModal()`
- `app.js:1953-1973`：旧训练事件绑定，当前已使用空元素保护

这些代码仍然属于兼容层，不能在没有迁移方案的情况下直接删除。

### 2.3 `training` / `meals` 仍参与数据契约

- `app.js:2368`：`ROOM_ARRAY_LIMITS` 仍包含 `trainings`、`meals`
- `app.js:2399-2403`：`serializeRoom()` 仍序列化它们
- `app.js:2478-2482`：`mergeRoomState()` 仍合并它们
- `app.js:2763`：已见数据集合仍包含 `trainings`
- `app.js:3076`：备份/导出仍包含 `trainings`
- `app.js:3112-3115`：公开 API 仍暴露 `addTraining`、`updateTraining`、`deleteTraining`、`updateFitnessPlan`

结论：训练和饮食不是“只剩一段死 CSS”，而是仍在同步、备份和公开 API 中。当前只能标记为 legacy，不能直接删除。

## 3. `life.js` 与旧页面并存关系

新版 Life UI 的启动路径：

- `life.js:36`：创建 `lifeApp`
- `life.js:38-39`：将新版根节点插入 `body`
- `life.js:231` 附近：`DOMContentLoaded` 后启用 `life-mode`、渲染页面并处理回顾提示

在 `life-mode` 下，新版 Life UI 是预期可见页面；旧 `.app`、旧 `.bottom-nav` 仍留在 DOM，但由 CSS 隐藏。也就是说，目前是：

```text
旧 DOM + 旧 app.js 兼容逻辑仍加载
                    ↓
新版 life.js 负责可见页面
```

另外，`life.js:192-193` 附近仍存在 `trainingSheet`、`trainingEdit` 等训练兼容入口。它们说明训练功能还没有完成从产品和数据契约上的退休。

因此，截图中的训练模块残留更像是旧 DOM/旧兼容路径重新可见，而不是音乐模块新增了训练内容。

## 4. CSS 审计

### 4.1 已确认的旧训练样式

`styles.css` 仍包含：

- `styles.css:663-666`：`.today-train`
- `styles.css:830-880`：`.train-list`、`.train-item`、`.train-date`、`.train-body`、`.train-muscle`、`.train-content`、`.train-foot`、`.train-actions` 等
- `styles.css:1274-1277`：旧训练响应式规则

这些规则本身不会自动生成训练 DOM，但会在旧结构被显示时恢复旧训练视觉，并增加与新版布局的选择器污染风险。

### 4.2 已确认的旧 Dashboard/导航样式

`styles.css` 仍包含旧布局相关规则：

- `styles.css:195`：旧桌面布局列定义
- `styles.css:630`、`styles.css:670`、`styles.css:885`、`styles.css:914`、`styles.css:984`：旧 grid 布局
- `styles.css:1211`、`styles.css:1251`、`styles.css:1321-1322`：旧 `.bottom-nav`
- `styles.css:1250`、`styles.css:1326`：旧 `.dash-grid`
- `styles.css:1681`：旧 `.app`、`.content`、`.page` 的小屏约束

这些规则主要作用于旧类名；在 `life-mode` 下旧壳被隐藏，但只要旧壳被错误显示，就可能重新参与布局。

### 4.3 横向溢出风险

当前扫描没有发现新版 Life 核心布局中明确的 `width:100vw` 直接证据。主要风险来自：

1. 旧 `.app`/`.content`/`.page` 与新版 Life 根节点同时存在；
2. 旧 Dashboard grid 在旧壳重新显示时恢复；
3. 旧训练卡片和固定列布局在小屏下参与排版；
4. 部分历史 CSS 仍以 `width`、grid 或 absolute 定位影响旧页面。

因此，横向裂开不能仅靠给 `body` 加 `overflow-x:hidden` 视为解决；那只会遮住症状，不能消除旧节点对布局的影响。

## 5. 可能的根因链

目前最符合证据的根因链是：

```text
旧 HTML 仍存在
    ↓
旧 app.js 仍加载并保留渲染/事件/同步兼容路径
    ↓
某条旧启动或旧缓存路径让旧壳重新可见
    ↓
损坏编码片段和旧训练 DOM 暴露
    ↓
旧 CSS 参与布局
    ↓
HTML 标签泄露、横向溢出、训练模块重新出现
```

音乐轨迹修复本身不涉及旧训练 DOM、旧 Dashboard 或 Worker 同步，因此不是这类问题的直接来源。

## 6. 建议修复顺序

### P0：如果线上再次出现空白页

1. 先确认页面实际版本号和 PWA 是否仍命中旧缓存；
2. 读取浏览器控制台第一条错误；
3. 保留当前 `life-boot` 启动保护；
4. 增加启动回归检查，至少验证 `lifeApp` 存在、旧 Dashboard 没有被激活。

### P1：清理旧 DOM，但需要单独提交

在确认以下功能不再依赖旧 DOM 后，再移除：

- `page-dashboard`
- `page-fitness`
- 旧 `.bottom-nav`
- 旧训练统计和训练卡片

删除前应先全局搜索对应 id/class 的 HTML、JS、CSS 引用，并保留一个可回滚提交。

### P2：再清理旧 CSS

旧 DOM 删除且引用归零后，再清理：

- 旧训练 CSS
- 旧 Dashboard grid/layout CSS
- 旧 bottom-nav CSS

不要在 DOM 清理前直接删除这些样式，否则会把当前页面回归风险和旧页面清理风险混在一起。

### P2：最后退休 `training` / `meals`

需要先制定：

- 旧房间数据兼容读取规则；
- 导出/备份兼容规则；
- Worker/客户端字段保留周期；
- 旧 API 的替代方式。

完成前不要从 `serializeRoom()`、`mergeRoomState()` 或公开 API 中硬删。

## 7. 本次审计变更范围

- 本次只新增本审计报告；
- 未修改 `index.html`、`app.js`、`life.js`、任何 CSS、Worker 或数据结构；
- 未删除训练/饮食兼容逻辑；
- 未重新部署；
- 最新生产启动复验通过，但旧 UI 残留仍需按上述顺序单独清理。

## 8. 阶段 5.1 执行结果

已完成 `index.html` 的编码与结构修复：

- 以已验证的正常 HTML 基线恢复页面文本与闭合标签；
- 保留当前生产版本号 `20260814-music-track-display-fix-1`；
- 修复旧 Dashboard、训练页、留言、心愿、音乐旧壳中的损坏字符和闭合标记；
- 未删除任何旧模块；
- 未修改 JS、CSS、Worker、同步逻辑或数据结构。

验证结果：

```text
非法 UTF-8 文件问题：已修复
损坏标记扫描：未发现
git diff --check：通过
```

阶段 5.1 仍然只解决 HTML 编码/结构污染；旧 UI DOM、旧 JS 兼容逻辑和旧 CSS 仍按本报告前述结论保留，下一步应单独执行 5.2 隔离，不应与本次混合。

## 9. 阶段 5.2 执行结果

已为旧 UI 增加结构级隐藏边界：

- 旧页面总壳：`#legacy-ui[hidden]`
- 旧移动端底部导航：`#legacy-bottom-nav[hidden]`

这样旧 Dashboard、旧训练页、旧侧边栏和旧页面内容仍保留在 DOM 中，`app.js` 仍可查询它们进行兼容处理，但浏览器不会把它们作为可见页面展示。新版 Life UI 仍由 `life.js` 独立创建和渲染。

本地检查结果：

```text
legacy-ui hidden：通过
legacy-bottom-nav hidden：通过
life-boot 保留：通过
新版 Life 入口脚本存在：通过
损坏标记：0
app.js 语法检查：通过
life.js 语法检查：通过
git diff --check：通过
```

本阶段未删除旧 DOM、未修改旧业务逻辑、未修改同步/Worker、未部署。下一步 5.3 需要继续检查 `app.js` 是否在 Life 模式下主动初始化旧页面，而不是继续修改 CSS。

## 10. 阶段 5.3 执行结果

已在 `app.js` 增加 Life 模式启动边界：

- 新增 `isLifeMode()`，识别 `life-boot` 和 `lifeApp`；
- Life 模式下，`goPage()` 不再进入旧页面路由；首页/留言仅转发给新版 Life 事件；
- Life 模式下，`onPageEnter()` 和同步后的 `renderCurrent()` 不再渲染旧 Dashboard、训练页或旧导航页面；
- 旧 `.nav-item`、`.bn-item` 事件绑定仅在非 Life 模式下注册；
- 旧 `[data-goto]` 快速入口点击处理仅在非 Life 模式下生效；
- 导入数据后的旧页面刷新调用增加空元素保护；
- 保留 `load()`、本地数据兼容、房间同步、轮询、Push 和音乐逻辑。

本地检查结果：

```text
app.js 语法检查：通过
life.js 语法检查：通过
git diff --check：通过
Life 模式旧页面渲染入口：已阻断
同步与本地数据入口：保留
```

本阶段未删除旧训练/饮食逻辑，未修改 Worker、room sync、数据结构或音乐推荐模块，未部署。下一步才是 5.4 CSS 隔离与旧样式引用收敛。

# CSS Legacy 影响审计

审计日期：2026-08-14
审计范围：`index.html`、已引用 CSS、`app.js`/`life.js` 的样式引用与旧页面边界
审计方式：只读扫描；本次不修改 CSS、HTML、JS、Worker 或同步逻辑，也不部署。

## 结论摘要

当前 CSS 可以分成两层：

1. `life.css`、`life-dashboard.css`、`life-dashboard-music.css`、`life-ritual.css`、`life-complete-state.css`：当前 Life 页面及其功能页的生产样式，不能按文件名直接删除。
2. `styles.css`：旧 Dashboard / 训练 / 旧导航的完整样式，同时还承载兼容层的设置、弹窗、Toast、音乐浮窗等规则。它目前仍被 `index.html` 引用，不能直接删除。

目前没有证据表明某个 CSS 文件可以安全地整文件删除。最明确的 legacy 残留集中在 `styles.css`，但由于旧 DOM、兼容 API、备份和同步字段仍保留，建议继续隔离后再做逐条清理。

## 1. CSS 文件与引用关系

| 文件 | 约大小 | 当前判断 | 处理建议 |
|---|---:|---|---|
| `styles.css` | 77,638 bytes | 旧系统主样式 + 兼容层 | 暂不删除；后续按选择器逐批清理 |
| `life.css` | 92,824 bytes | Life 主视觉、页面、Sheet、喝水、旅行、音乐等 | 保留 |
| `life-dashboard.css` | 3,282 bytes | Life 首页待办、共同进度、对方动态、音乐摘要 | 保留，名称虽含 dashboard 但选择器均为 `life-*` |
| `life-dashboard-music.css` | 680 bytes | Life 首页双人音乐卡片 | 保留 |
| `life-ritual.css` | 2,048 bytes | 星座、抽签等 Life 仪式页 | 保留 |
| `life-complete-state.css` | 963 bytes | Life 完成状态 | 保留 |

`index.html` 当前引用以上六个本地 CSS 文件，另引用 Phosphor 图标 CSS。没有发现由 JS 动态创建 `<link>` 加载本地 CSS 的证据。

## 2. 已确认的旧 CSS 残留

`styles.css` 仍包含以下旧 UI 样式：

- 旧 Dashboard 布局：`.app`、`.sidebar`、`.content`、`.page`、`.dash-grid`；
- 旧训练页面：`.today-train`、`.train-list`、`.train-item`、`.train-date`、`.train-body`、`.train-muscle`、`.train-content`、`.train-foot`、`.train-actions`；
- 旧底部导航：`.bottom-nav`、`.bn-item` 及对应响应式规则；
- 旧通用卡片和表单：`.card`、`.card-head`、旧 `.page-*`、`.modal`、`.toast`；
- 旧音乐浮窗：`.music-float-panel`、`.music-track`。

这些规则与旧 DOM 仍然存在，因此不能仅凭“当前 Life 模式看不到”就删除。

## 3. 当前 Life CSS 的污染风险

### 低风险：Life 专属选择器

大多数当前规则使用明确的 `life-*` 命名，例如：

- `.life-page`、`.life-section`、`.life-card`；
- `.life-weather`、`.life-partner-*`、`.life-interaction-*`；
- `.life-music-*`、`.life-hydration-*`、`.life-travel-*`；
- `.life-sheet-*`、`.life-ritual-*`、`.life-review-*`。

这部分与旧 `.card`、`.page`、`.bottom-nav` 的直接冲突风险较低。

### 中风险：兼容层全局规则

`styles.css` 中的 `body`、`.app`、`.content`、`.page`、`.modal`、`.toast`、按钮和输入控件规则仍是全局或半全局规则。Life CSS 已通过 `body.life-mode` 隐藏旧壳，并对设置弹窗和 Toast 做了专门覆盖，但后续新增页面时仍需避免使用未命名空间的旧类名。

### 高风险：旧壳意外重新可见

当前最高风险不是某一条颜色规则，而是旧壳重新进入布局：

```text
旧 .app / .bottom-nav / .page
        ↓
旧 grid、sidebar、训练卡片样式重新生效
        ↓
新版页面出现横向溢出、重复导航或旧训练模块
```

5.2 的 `#legacy-ui[hidden]`、`#legacy-bottom-nav[hidden]` 和 5.3 的 Life 模式启动隔离已经降低了这条风险，但在删除旧 DOM 之前仍不应删除对应 CSS。

## 4. 横向溢出检查

扫描发现旧样式中存在以下需要继续关注的布局规则：

- `.app` 的桌面双列布局 `grid-template-columns: 232px 1fr`；
- 多处旧 Dashboard / 训练 grid；
- 旧移动端 `.app`、`.content`、`.page` 响应式规则；
- `.music-float-panel` 使用 `calc(100vw - ...)` 的旧浮窗布局；
- Life 页面自身主要使用 `minmax(0, 1fr)`、`min-width:0` 和 `overflow:hidden`，未发现新的 `width:100vw` 核心布局证据。

结论：横向溢出仍应优先从“旧壳是否被错误显示”排查，不能只靠 `body { overflow-x:hidden }` 掩盖。

## 5. 可安全删除候选

### 当前没有可直接整文件删除项

原因：

- `styles.css` 仍由 `index.html` 引用；
- 其中包含兼容设置、弹窗、Toast、旧页面和旧公开 API 依赖；
- `life-dashboard.css` 虽名称含 `dashboard`，但实际选择器均属于当前 Life UI；
- `life-dashboard-music.css` 仍对应当前 Life 音乐卡片；
- `life-ritual.css` 和 `life-complete-state.css` 仍有明确页面用途。

### 后续可逐条评估的候选

在确认旧 DOM 和旧 API 退休后，可分批清理 `styles.css` 中：

1. `.train-*`、`.today-train` 及仅服务旧训练页的响应式规则；
2. `.dash-grid`、旧 `.sidebar`、旧 `.app` 布局规则；
3. `.bottom-nav`、`.bn-item` 及旧导航专属规则；
4. 旧 `.music-float-panel` / `.music-track`，但需先确认音乐浮窗已完全由 Life 音乐模块接管。

每批都应先全局搜索 HTML、JS、CSS 引用，再单独提交和回归测试。

## 6. 是否需要立即做 CSS namespace 隔离

暂不建议对整个 `styles.css` 做大规模 namespace 重写。原因是：

- 会同时改变大量旧兼容规则；
- 可能影响设置、Toast、导入导出和旧 API；
- 当前 Life 页面已有结构级隐藏和启动隔离；
- 直接重写选择器的收益小于风险。

更稳妥的做法是：

1. 保持旧 CSS 不动；
2. 新增 CSS 一律使用 `life-*` 或功能名空间；
3. 旧 DOM 继续保持 `hidden`；
4. 待旧 DOM/API 归零后，再删除旧规则而不是重命名整套旧 CSS。

## 7. 建议下一步

1. 先保留当前 CSS 文件和引用，不部署这次只读审计结果；
2. 在浏览器中验证 Life 模式启动瞬间、手机宽度和桌面宽度；
3. 下一刀只清理 `styles.css` 中已确认无 HTML/JS 引用的 `.train-*` 规则；
4. 完成旧 DOM 与旧 API 退休后，再清理 `.app`、`.sidebar`、`.bottom-nav` 和旧 Dashboard grid；
5. 每批删除独立提交，避免 CSS 问题与业务问题混在一起。

## 8. 本次变更边界

- 仅新增本审计文档；
- 未修改 CSS、HTML、JS、Worker、同步或数据结构；
- 未删除任何旧规则；
- 未执行部署。
# 5.4.2.1 执行结果：旧 Dashboard CSS 独立化

- 新增 `legacy-dashboard.css`，承接旧 Dashboard 的专属规则：统计卡、喝水卡、Dashboard 网格、旧训练摘要、快捷入口和相关响应式规则。
- `index.html` 已在 `styles.css` 后加载该兼容层，确保旧结构仍可恢复，同时不改变新版 Life 的样式来源。
- `styles.css` 中已移除对应的主要 Dashboard 基础规则；仍与其他旧功能共用的选择器暂时保留，避免误伤。
- 未修改 JS、Worker、房间同步、数据结构和新版 Life DOM。
- 未部署；本阶段只完成本地 CSS 职责拆分。
# 5.4.2.2 执行结果：旧训练 CSS 独立化

- 新增 `legacy-training.css`，承接旧训练页的周计划、训练计划、训练日记、训练记录和移动端适配规则。
- `index.html` 已在兼容样式之后加载该文件，旧训练 DOM 仍可在解除隐藏后使用。
- `styles.css` 中训练专属基础规则已移出；公共 `.pill`、`.card`、`.button` 等规则继续保留。
- 训练数据、旧初始化、同步字段和 API 均未修改。
- 未部署；本阶段只完成本地 CSS 职责拆分。
# 5.4.2.3 执行结果：旧导航 CSS 独立化

- 新增 `legacy-navigation.css`，承接旧侧边栏、旧导航项、旧移动端底部导航、徽标定位和旧导航响应式规则。
- `index.html` 已加载该兼容层；新版 `.life-nav` / `.life-tab` 未被迁移或修改。
- `styles.css` 中旧导航主体规则已移出，公共触摸反馈中的旧选择器仍保留，因为它们属于跨组件兼容规则。
- 旧导航 DOM 和启动隐藏逻辑未删除，JS、同步、Worker 和数据结构未修改。
- 未部署；本阶段只完成本地 CSS 职责拆分。

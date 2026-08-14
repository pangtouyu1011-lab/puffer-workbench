# 第二阶段 CSS 收敛审计

审计日期：2026-08-14  
范围：只读分析；本次不修改任何 CSS、HTML、JS 或业务数据。

## 结论

当前问题不是「还有大量可以直接删除的无用 CSS」，而是 Life UI 的当前视觉由多份后期覆盖样式共同构成。直接删除任意一份会高概率造成手机端布局回退、弹窗失效或首页样式变化。

第二阶段应做的事情是：**把已经生效的最终样式收拢进一个明确的 Life 主样式文件，再逐份移除被收拢的覆盖文件。** 这不是视觉重做，也不是 JS 重构。

## 当前加载顺序

1. `styles.css`：旧壳层、全局基础样式、设置/同步等兼容页面。
2. `life.css`：Life UI 主体，包含首页、导航、弹窗、旅行、喝水、宠物等。
3. `life-ritual.css`：星座、抽签 Bottom Sheet。
4. `life-dashboard.css`：首页待办、互动、对方动态等后期补丁。
5. `life-dashboard-music.css`：双人音乐卡片补丁。
6. `life-home-compact.css`：移动端首页紧凑排版补丁。
7. `life-unified-preview.css`：当前统一玻璃/浮层视觉覆盖。
8. `life-complete-state.css`：今日互动完成态。

## 规模基线

| 文件 | 大小 | 主要职责 | `!important` 声明 |
| --- | ---: | --- | ---: |
| `styles.css` | 77,638 B | 旧壳层、基础样式、设置与兼容页 | 8 |
| `life.css` | 80,096 B | Life UI 主体与历史追加规则 | 201 |
| `life-ritual.css` | 2,048 B | 星座/抽签 | 4 |
| `life-dashboard.css` | 3,282 B | 首页信息模块 | 0 |
| `life-dashboard-music.css` | 680 B | 音乐模块 | 0 |
| `life-home-compact.css` | 1,141 B | 首页紧凑布局 | 5 |
| `life-unified-preview.css` | 6,277 B | 当前统一视觉覆盖 | 25 |
| `life-complete-state.css` | 963 B | 完成态 | 1 |

总计约 172 KB，8 份样式表，244 条 `!important` 声明。

说明：`life.css` 等文件大量压缩在少数物理行内，因此不能只按“行数”判断复杂度，应以选择器、覆盖关系和实际视觉回归为准。

## 覆盖关系与风险点

### 1. `life.css` 是核心，但存在多轮历史追加

`life.css` 是必须保留的主文件，不过其中已经存在同一模块的多次定义，尤其是旅行页、Bottom Sheet、悬浮宠物、互动卡片等。旅行页相关选择器在文件前后出现多轮规则，说明它经历过地图版、时间线版和紧凑版叠加。

这份文件是第二阶段最值得整理的目标，但不能通过大范围替换或格式化后顺手改值；必须按功能区逐块验证。

### 2. `life-unified-preview.css` 不是预览废文件

文件名容易误导，但它承载了当前实际使用的统一卡片、导航和 Bottom Sheet 视觉。它覆盖了 `.life-card`、`.life-hero`、`.life-together-card`、`.life-music-pair`、`.life-nav`、`.life-sheet` 等关键模块，并使用 25 条 `!important` 固定最终效果。

它应当在收拢后被删除，但现阶段不能直接移除链接。

### 3. 首页样式有三份补丁共同组成

`life-dashboard.css`、`life-dashboard-music.css`、`life-home-compact.css` 都仍被当前 DOM 使用：

- 待办、互动、对方动态卡；
- 双人音乐卡；
- 首页顶部紧凑排版和旧音乐浮层隐藏规则。

它们不是 dead code；可以作为第一批“搬运进 `life.css` 后删除”的候选。

### 4. 跨文件重复不是天然可删

共发现 54 个在多份样式文件中出现的类名 token，例如：

- `.life-together-card` 出现在 5 份文件；
- `.life-mode` 出现在 4 份文件；
- `.life-music-person` / `.life-music-pair` 出现在多份首页样式；
- `.life-head`、`.life-sheet`、`.life-card`、`.life-nav` 也有多处定义。

这些重复多数是“基础规则 + 后续视觉覆盖”，不是简单的无引用代码。收敛时要保留加载顺序最终生效的属性，而不是按出现次数删除。

## 推荐的目标结构

第二阶段完成后，样式文件应尽量收敛为：

```text
styles.css                 旧壳层/全局基础（暂不动）
life.css                   Life UI 的唯一主样式
life-ritual.css            星座、抽签功能样式
life-complete-state.css    今日互动完成态
```

后续可移除的文件（前提是规则已完整搬运并视觉复验）：

```text
life-dashboard.css
life-dashboard-music.css
life-home-compact.css
life-unified-preview.css
```

## 安全执行顺序

### Commit 1：收拢首页补丁

将 `life-dashboard.css`、`life-dashboard-music.css`、`life-home-compact.css` 的当前有效规则按首页模块整理进 `life.css`，保持属性和值不变；再删除三份链接和文件。

验收：主页、待办、互动、音乐、移动端紧凑布局、桌面布局均与当前一致。

### Commit 2：收拢统一视觉覆盖

将 `life-unified-preview.css` 的最终视觉规则放到 `life.css` 对应模块末尾，逐项验证后删除其链接和文件。

验收：卡片、导航、所有 Bottom Sheet、设置、旅行页、喝水卡、完成态在 iPhone 和桌面均无视觉回退。

### Commit 3：只移除已被证明冗余的 `!important`

不做全局替换。每一条移除都必须满足：同选择器同属性的层级/加载顺序仍能保证相同结果，并完成页面复验。

### Commit 4：格式化与分区注释

在行为完全稳定后，再把 `life.css` 按首页、弹窗、旅行、喝水、宠物等区块格式化和标注。此提交只改变排版，不改选择器和值。

## 本阶段明确不做

- 不删除 `styles.css`；
- 不改 `app.js`、`life.js`、同步、PWA 或通知；
- 不改任何数据结构；
- 不改视觉方案、间距、颜色和组件功能；
- 不删除旧壳层 DOM；这些仍被当前页面路由和设置功能引用；
- 不批量移除 `!important`。

## 每个提交的回归清单

- 360px、393px、430px 手机宽度与桌面宽度；
- 首页照片、天气、TA 的今天、互动、喝水、音乐、陪伴；
- 星座、抽签、今日默契、完成态 Bottom Sheet；
- 设置与同步弹窗；
- 留言、旅行、共同相册、悬浮胖头鱼；
- PWA 冷启动与刷新；
- 不出现控制台错误，不改变同步请求。

## 下一步建议

可以开始 Commit 1。它是风险最小、收益最清晰的一刀：减少 3 个首页补丁文件，但不碰核心同步和数据逻辑。完成后先在正式环境进行手机/桌面视觉复验，再进入 Commit 2。

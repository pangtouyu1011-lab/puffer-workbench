# `life-unified-preview.css` 收拢前审计

审计日期：2026-08-14  
性质：只读审计。本文件不触碰现有视觉、功能、同步或数据结构。

## 结论

`life-unified-preview.css` 是**当前生产视觉的最终覆盖层**，不是可直接删除的预览文件。文件名中的 `preview` 仅反映它最初的来源；目前它由 `index.html` 正式加载，且在 `life.css`、首页紧凑布局和 Dashboard 样式之后加载。

因此后续只能按组件、按最终生效属性收拢；不得整份复制，也不得先删除文件再补救。

## 1. 规则规模与功能分类

按 CSS 嵌套规则块统计，共识别 69 个规则块（其中包含关键帧内部帧）。由于一条规则可能同时影响首页与通用卡片，下面按功能归类；“通用”与“首页”中包含的复合选择器不视为可删的重复。

| 类别 | 规则块 | 主要影响 |
| --- | ---: | --- |
| 通用 / 全局视觉 | 约 34 | 页面背景、浮动装饰、标题、通用卡片、列表、Hero、我们的页面、响应式宽度 |
| 首页组件 | 约 20 | 天气、快捷卡、音乐、互动点亮、首页卡片阴影 |
| Bottom Sheet | 5 | 弹窗背景、内容底部间距、标题、内嵌卡片、主按钮 |
| 底部导航 | 5 | 毛玻璃背景、阴影、选中态上浮和装饰 |
| 动画 / 轻交互 | 3 组关键帧 + 多处触发规则 | 背景漂浮、天气星光、完成点亮、按压反馈、减少动态效果 |

补充：该文件包含 25 条 `!important` 声明。它们集中在卡片边框/背景/圆角/阴影、导航背景、Bottom Sheet 背景和正文底距，属于当前最终视觉锁定，而非可机械移除的噪声。

## 2. 关键覆盖链：当前最终视觉是什么

| 组件 | `life.css` 基础 | 后续覆盖 | 当前最终结果 |
| --- | --- | --- | --- |
| `body.life-mode` | `var(--life-bg)` 基础背景 | unified 改为暖色/浅蓝径向背景 | unified 背景生效 |
| `.life-head` | 底部间距 `18px` | unified `20px` | `20px` |
| `.life-title` | `34px`，小屏曾压至 `32px` | unified `36px` | unified 标题尺寸生效 |
| `.life-card` | 18px 圆角、纯色背景 | unified `24px`、玻璃渐变、阴影，带 `!important` | unified 卡片视觉生效 |
| `.life-weather` | `overflow:hidden`、最小高 `158px` | unified 改为可溢出、最小高 `156px`、投影与星光 | unified 视觉生效 |
| `.life-quick-card` | 18px 圆角、最小高 `108px` | unified 22px 圆角、最小高 `120px`、交替渐变 | unified 首页快捷卡生效 |
| `.life-together-card` | Life 主样式有基础卡片；紧凑布局已设 `padding:10px 14px` | unified 只覆盖边框颜色和阴影 | 紧凑布局的内边距 + unified 阴影共同生效 |
| `.life-music-pair` | 紧凑布局曾锁定透明无阴影 | unified 后加载并用 `!important` 写入卡片阴影 | 当前以 unified 阴影为准，迁移时不可遗漏 |
| `.life-nav` | 固定导航结构和选中颜色 | unified 毛玻璃背景、阴影、选中上浮 | unified 导航视觉生效 |
| `.life-sheet` | 基础弹窗几何、遮罩、内容滚动 | unified 半透明背景、顶部阴影、正文底距 | unified 弹窗视觉生效；旅行专用全屏规则仍由 `life.css` 管理 |
| `.life-us-hero` / 统计卡 | 基础暖色卡片 | unified 24px 圆角、玻璃背景、装饰圆形 | unified「我们」页视觉生效 |

重点：同一个类名出现在多文件不意味着前一个定义无用。许多组件当前正是“结构来自 `life.css`、紧凑间距来自首页补丁、最终视觉来自 unified”的组合。

## 3. 伪废弃确认

| 检查项 | 结果 |
| --- | --- |
| `index.html` 正式引用 | 是，当前加载顺序靠后 |
| 项目文档描述 | 交接文档明确标记为“当前统一的可爱 iOS 视觉样式” |
| 是否覆盖生产关键组件 | 是：卡片、天气、导航、Bottom Sheet、我们页 |
| 是否可视为 Dead Code | 否 |
| 是否可直接删除 | 否 |

`preview`、`unified`、`v2`、`new`、`final` 一律不能作为删除依据。未来清理必须以“运行时引用 + DOM 使用 + 最终覆盖链 + 视觉复验”四项共同判定。

## 4. 推荐收拢批次

### 批次 A：视觉变量与通用静态外观

先迁移背景、卡片边框、圆角、阴影、颜色、标题字距等静态视觉规则。

范围：`body.life-mode`、`.life-page` 装饰、`.life-card`、`.life-hero`、`.life-mini-list`、`.life-row`、`.life-icon`、`.life-us-*`。

不动：导航、Bottom Sheet、触摸动画、天气点击反馈。

验收：首页、我们页、旅行页在 375px / 390px / 桌面下视觉不回退。

### 批次 B：首页组件

迁移天气、快捷卡、互动点亮、音乐卡与首页区块宽度规则。

重点保留：

- `.life-together-card` 的紧凑内边距；
- `.life-music-pair` 当前实际生效的 unified 阴影；
- `.life-weather` 的 `overflow:visible`，避免胖头鱼被裁切；
- `.life-quick-card` 当前高度与交替背景。

验收：首页、小屏、桌面、宠物、今日互动、喝水、音乐都保持一致。

### 批次 C：交互组件（风险最高）

最后迁移导航和 Bottom Sheet：`.life-nav`、`.life-sheet`、`.life-sheet-body`、`.life-sheet-primary`、星座/抽签/相册内嵌卡片，以及动画/减少动态效果。

验收：留言、旅行新增、默契挑战、设置、星座、抽签、今日回顾、底部导航、PWA 启动都需复验。

## 5. 删除前的强制检查

只有 A、B、C 三批都完成并视觉复验后，才允许删除 `life-unified-preview.css`：

1. 全局搜索 `life-unified-preview`，应只剩 `index.html` 的 `<link>` 引用及本审计/交接文档；
2. 删除 `<link>` 与 CSS 文件；
3. 再次搜索运行时代码，结果必须为 0；
4. 进行手机、桌面、PWA 和 Bottom Sheet 回归检查；
5. “迁移规则”和“移除文件”保持为独立提交。

## 6. 后续命名规则

新增 CSS 不再使用 `test`、`new`、`v2`、`final`、`preview` 作为正式文件名。

采用“功能名.css”：

```text
challenge.css
travel.css
complete.css
hydration.css
```

功能稳定后，再通过一次单独审计决定是否收拢到 `life.css`。不在临时样式文件中无限追加正式功能。

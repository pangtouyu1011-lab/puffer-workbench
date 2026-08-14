# 第一阶段旧 UI 清理审计

审计日期：2026-08-14  
范围：`index.html`、`styles.css`、`app.js`、`life.js` 与现有 Life 样式文件。  
原则：仅删除已确认无引用的旧 UI / 样式；不改数据结构、同步、Worker、PWA、Push 或视觉设计。

## 冻结验收范围

- 首页：胖头鱼、天气、今日状态、今日待办、今日默契。
- 功能：待办、喝水与饮料、旅行、回忆、留言、音乐、相册、心愿。
- 数据：本地保存、双人同步、Worker 同步、图片上传。
- 系统：PWA、Push 通知、房间设置与同步状态。

## 引用关系结论

| 区域 / 文件 | 现状 | 运行时引用 | 本阶段结论 |
| --- | --- | --- | --- |
| `.app`、`.sidebar`、`.nav` | 新 Life UI 启动后隐藏 | `app.js` 仍用来维持兼容路由、设置弹窗和同步状态 | 不删除 |
| `.bottom-nav`、`.bn-item` | 新 `life-nav` 已视觉替代 | `goPage()`、未读留言徽标、跨标签更新仍查询并更新它们 | 不删除 |
| `#page-dashboard` 和其他旧 `.page` | 视觉上不再作为主界面 | `onPageEnter()`、旧渲染函数与回退路径仍直接引用 | 不删除 |
| `#modalMask` / `#modal` | 旧模态容器 | 设置、导入/导出、同步等入口仍复用 | 不删除 |
| `#musicFloatPanel` | 旧浮层容器 | Life 首页的音乐卡片仍通过 `#musicFloatToggle` 打开它 | 不删除 |
| `life-dashboard.css` | 名称含 dashboard，但不是旧页面样式 | 提供首页待办、互动、对方动态等 Life 类的样式 | 保留 |
| `life-dashboard-music.css` | 名称含 dashboard | 提供双人音乐卡片的样式 | 保留 |
| `life-home-compact.css` | Life 首页紧凑布局 | 提供今日陪伴、互动、音乐布局 | 保留 |
| `life-unified-preview.css` | 当前 Life 视觉覆盖层 | 当前 Life 页面布局、圆角、背景、弹窗效果 | 保留 |
| `life-ritual.css` | 当前 Life 弹窗样式 | 双人运势、今日抽签 Bottom Sheet | 保留 |

## 已确认安全删除

`index.html` 中旧“吃饭转盘”样式（`.meal-card` 至 `.meal-empty`）只在该样式块自身出现：

- 没有 HTML 节点；
- 没有 JavaScript 事件或渲染调用；
- 没有 Life UI 使用；
- 没有同步逻辑依赖。

本次仅删除这些无引用样式。

## 标记为第二阶段的遗留数据

`meals` 仍位于本地状态、房间序列化和 `mergeArr()` 同步路径中。它已没有 UI，但删除会改变历史房间数据与同步 payload，属于数据结构变更，故不纳入本阶段。

## 当前风险与下一步

目前旧 HTML 不是纯 dead code，而是新 Life UI 仍借用的兼容外壳。要移除它，需要先把设置、音乐、回退路由和旧渲染入口迁移为独立的 Life UI 能力；这属于第二阶段重构，不能伪装成“无功能变化的清理”。

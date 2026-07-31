# Profile 管理控制台 UI 壳接入清单

上级：[[10-UI壳接入清单]]

## UI 壳职责

在真实项目 `src/manager/public/` 内承接 Stitch 的单页多 Screen 视觉结构，覆盖 Profile 列表、表单、目录迁移、备份警告、详情、删除确认和图片管理。当前已接入同源本地管理 API，运行时不使用 Stitch 静态数据。

## Stitch Screen 映射

| Stitch Screen | 类型 | 逻辑区域 | 目标文件 |
|---|---|---|---|
| `GPT Web Image - 导航易读性优化版` | 单页多 Screen 展示 | Profile 总览 | `index.html`、`styles.css` |
| 同一 Screen | 页面/表单状态 | 创建、导入、编辑 Profile | `index.html`、`app.js` |
| 同一 Screen | 页面/迁移预检 | 默认目录、迁移、保留、备份恢复 | `index.html`、`app.js` |
| 同一 Screen | 详情/危险操作 | Profile 详情、占用、删除二次确认 | `index.html`、`app.js` |
| `GPT Web Image - 图片管理全功能完备版 (含状态库)` | 页面/状态库/弹窗 | 图片管理、Profile 选择、筛选、网格、状态参考、图片详情 | `index.html`、`styles.css`、`app.js` |

## 接口与状态预留

- 已接 API：`GET/POST/PATCH/DELETE /profiles`、`/profiles/:id/activate`、`/profiles/:id/check`、`/profiles/:id/open`、`/directories/**`、`/backups/**`、`/profiles/:id/images/**`。
- 状态入口：loading、scanning、empty、success、error、disabled、selected、checking、needs_login、membership_ineligible、technical_failure、browser_open、task_busy、migration_planned/running/failed、backup_warning、delete_confirm。
- 事件入口：导航切换、创建、导入、编辑、刷新扫描、资格检查、启用、打开浏览器、目录选择、迁移/保留、备份、恢复、删除弹窗开关与二次确认。
- 接线状态：上述事件和状态已由 `app.js` 统一管理；旧 mock 只保留空兼容导出。

## 控件规格盘点

已根据 `design/stitch/18230660193198829480/06f8eaec0ace43eb91960233146f13c9/source.html` 和 Stitch design system 完成首轮盘点；实例级复修必须继续以 HTML 为硬依据。

| 类别 | 必须记录 |
|---|---|
| 按钮 | 常规主按钮约 40px 高，主操作使用 mint/green 填充；次要按钮白底边框；图标按钮约 32px 占位；圆角存在 8px、12px 和 full 三类，不能统一。 |
| 图标 | Font Awesome；导航和状态图标约 16px，品牌图标约 20px，统计卡图标容器约 56px；纯图标按钮必须保留独立占位。 |
| 输入控件 | 表单 input 为 40px 高、约 16px 水平内边距、1px 边框和约 8px 圆角；radio/checkbox 保留原生尺寸层级。 |
| 标签 | 登录、会员、当前启用和任务状态使用 pill/badge；Plus、Pro、Go、未知和危险态颜色不能合并。 |
| 页面结构 | 顶部导航约 64px，内容最大宽度 `max-w-7xl`，页面 gutter 16/24/32px；实际 Screen 使用顶部导航，不使用固定侧栏。 |
| 卡片与表格 | 当前启用横幅为大圆角卡片；统计卡为白色卡片；表格容器圆角约 16px，表头浅灰，行高和操作列沿用原 HTML。 |
| 危险操作 | 删除详情使用红色按钮；弹窗遮罩、内容容器、footer 和关闭按钮都必须按 HTML 保留。 |
| 响应式 | 原始 HTML 在 `md` 断点隐藏顶部导航按钮；390px 实测出现顶部导航溢出和横幅垂直挤压，必须在复修中解决而不改变桌面布局。 |

### 图片管理控件规格盘点

| 类别 | Stitch 实例规格与承接要求 |
|---|---|
| Profile 选择器 | 桌面宽 256px、高 40px、12px 圆角；窄屏占满可用宽度，必须始终保留切换入口。 |
| 统计卡 | 三列，16px 内边距、12px 圆角；图标容器 48×48px，数值 24px，标签 12px。 |
| 搜索与筛选 | 搜索框高 40px、左侧 16px 图标占位；时间和筛选按钮高 40px、8px 圆角；网格/列表按钮位于独立 4px 内边距容器。 |
| 图片网格 | 桌面四列、24px gap，窄屏单列；预览区保持 1:1；卡片圆角 12px，状态标签 10px 字号，元信息 10–12px。 |
| 状态 | SUCCESS、PROCESSING、ERROR 保留独立颜色与尺寸；未选择、无图片、扫描失败使用互斥业务状态锚点，静态壳仅作视觉状态参考。 |
| 图片详情 | 最大宽度 1024px、高度 85vh；桌面左右分栏，右侧 400px；预览按钮 40×40px；底部操作按钮高 40px。 |
| 不适用 | 当前 Stitch 图片管理 Screen 不包含 textarea、checkbox、radio、switch、数据表格和分页控件，不得虚构。 |

## Stitch 设计令牌事实

- 字体：Inter；正文 14px/20px，辅助文字 13px/18px，标题 20px/28px 和 16px/24px，标签 12px/16px。
- 主色：`#2563eb`；页面实际 mint 视觉使用 `#22c55e`、`#16a34a` 和 `#f0fdf4`；背景还包含浅蓝/浅绿径向渐变。
- 设计系统表面色：`#faf8ff`、`#f3f3fe`、`#ededf9`、`#ffffff`；实际 Screen 的 body 背景以 HTML 的 `#f0fdf4` 为第一依据。
- 间距：8px/4px 节奏；顶部栏 64px；页面边距 24px；卡片内边距 16px；设计系统记录表格行高 40px。
- 设计系统中的 `sidebar_width: 232px` 对当前 Screen 不适用，原因是实际 HTML 使用顶部导航而不是侧栏。

## 已知复修项

1. 390px 视口顶部导航内的刷新按钮被挤成竖排并遮挡右侧操作。
2. 390px 视口当前启用 Profile 横幅的 Membership、登录和 Chrome 状态发生窄列挤压。
3. 390px 视口统计卡已纵向堆叠，但必须继续验证下方 Profile 表格/操作区是否有横向溢出。
4. Stitch 原始产物使用 Tailwind CDN；已迁移为本地 Tailwind CSS 和 Font Awesome 资产，三视口页面复核确认无外部请求。

## 样式边界

- 所有页面样式由 `styles.css` 提供，并以 `[data-manager-shell]` 为主要作用域。
- 不使用项目外的通用 Button/Input/Table 默认尺寸覆盖 Stitch 实例规格。
- 视觉对齐前禁止为了复用而合并不同按钮、图标、输入框、标签或操作区规格。
- 技术表达需要调整时，只允许实现路径等价，视觉尺寸、比例和排版结果仍以 Stitch 为准。

## 当前完成定义

初次接收和图片管理实例级细节复修已通过，Profile、目录、备份、浏览器和图片 API 已接线。全量自动化和 1280×1024、768×900、390×844 页面复核已通过；本壳状态为“内部测试通过，待真机实测”，真机与 Windows 用户验收仍是后续门禁。

## 图片管理新增 Screen

| 项目 | 当前规划 |
|---|---|
| Screen 名称 | `GPT Web Image - 图片管理全功能完备版 (含状态库)` |
| 来源 | Stitch Project `18230660193198829480` / Screen `52f2dc24e0cd4878861f315a7edefa28` |
| 原始产物 | `design/stitch/18230660193198829480/52f2dc24e0cd4878861f315a7edefa28/` |
| 目标区域 | 现有顶部导航下的同一管理控制台壳 |
| 当前状态 | 已下载并承接到真实 UI 壳，已接入真实单 Profile 图片索引和本地 API；三视口复核已通过，待真实环境验收 |
| 允许编辑 | 仅现有 `src/manager/public/**` 白名单和本单壳清单明确的文件 |
| 禁止编辑 | 真实 Profile、图片扫描/API、浏览器控制、认证数据、全局样式和无关页面 |

### 已接入接口/状态锚点

- 数据：`selectedProfileId`、`ImageRecord`、`ImageIndex`、`ImageFilter`、`ImageSort`、`ProjectGroup`。
- 状态：profile_unselected、index_loading、index_empty、no_results、scan_error、directory_missing、permission_denied、file_missing、file_corrupt、generating、generation_failed、preview_open。
- 事件：选择 Profile、扫描、筛选、排序、分组、分页、打开详情、复制路径、打开目录和导出。
- 门禁结果：控件规格盘点、初次接收检查、实例级细节复修和真实 API 接线均已完成；后续仅保留真机验收门禁。

### 图片管理 Screen 接收检查

- HTML 明确包含顶部导航、Profile 选择器、统计区、搜索/时间/筛选/视图切换控件、图片网格、详情弹窗及多种状态示例。
- 业务流程必须收敛为：进入图片管理先显示 Profile 选择态；选择后只渲染该 Profile 的图片；选择器始终保留，切换后清空旧索引并只显示新 Profile 图片。
- 静态原型同时展示多种状态，接入时必须拆成互斥状态机，禁止把示例卡片全部当成当前真实数据。
- 原型无图片删除入口，接入时不得新增删除或批量删除操作。

### 九维复修结果

1. 页面结构与布局：图片管理已作为同一顶部导航壳内的 `view-images`，未创建独立页面壳。
2. 尺寸与间距：保留 256px Profile 选择器、40px 工具控件、三列统计卡、桌面四列/移动单列网格和 85vh 详情弹窗。
3. 字体与文本：文件名和项目/任务信息使用单行截断，状态标签保持 10px，移动端未出现竖排文本。
4. 颜色与样式：成功、处理中、错误和空态保持独立语义颜色、边框、圆角与阴影。
5. 控件规格：搜索、筛选、视图切换、图片详情导航和底部操作区保持各自实例尺寸。
6. 图片资源：使用 Stitch 下载资源的本地副本，不使用相似占位图。
7. 层级关系：图片状态标签、遮罩和详情弹窗均按原始层级承接，弹窗无错误遮挡。
8. 状态表现：静态数据展示成功/处理中/缺失；未选择、无图片、扫描失败保留为视觉状态锚点，未伪装为真实 API 状态。
9. 响应式：1280px 与 390px 均无横向溢出；移动导航的刷新操作固定为 40×40 图标按钮，用户头像在窄屏隐藏以避免裁切。

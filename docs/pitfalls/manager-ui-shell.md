# Profile 管理 UI 壳避坑

## Stitch 桌面稿不能代替窄屏验收

**现象**：Stitch `GPT Web Image - 导航易读性优化版` 在 1280px 视口可以打开并切换视图，但 390px 视口出现顶部刷新按钮被挤成竖排、启用 Profile 横幅状态文字被压窄的问题。

**根因**：原始 HTML 的导航在 `md` 以下隐藏部分操作，横幅内部状态项没有足够的收缩和换行约束；桌面截图通过不代表窄屏排版稳定。

**正确做法**：Stitch UI 壳初次接收后必须单独进行 390px、768px 和桌面视口检查；把挤压、溢出和文字竖排列入实例级细节复修，不能直接进入业务接线。窄屏长文本主操作应保留稳定的 40×40 点击区域并切为图标表达，同时隐藏最低优先级的重复账户入口，不能让按钮文字在狭窄剩余空间内逐字换行。

**验证方式**：使用 `npm run preview:manager`，在 1280×1024 和 390×844 视口分别截图；检查 `document.documentElement.scrollWidth`、顶部导航、当前 Profile 横幅、统计卡、列表和弹窗。

**禁止事项**：不得只看 Stitch 桌面截图就声明响应式完成；不得用重新设计整页的方式掩盖实例级尺寸问题。

**相关文件或命令**：`src/manager/public/index.html`、`liran_docs/10-UI壳接入清单.md`、`liran_docs/ui-shells/Profile管理控制台-UI壳接入清单.md`、`npm run preview:manager`。

**适用范围**：所有从 Stitch 桌面 Screen 承接到真实前端的本地管理页面。

## Tailwind CDN 警告不是页面业务错误

**现象**：本地预览控制台出现 `cdn.tailwindcss.com should not be used in production` 警告，但页面结构、视图切换和弹窗交互仍然可用。

**根因**：Stitch 原始 HTML 直接依赖 Tailwind CDN；这是部署方式警告，不等于本地 UI 壳脚本或业务接口失败。

**正确做法**：UI 壳实例级复修阶段可先保留 Stitch 的 CSS/依赖事实并记录警告；第一次 `/goal` 接业务时必须迁移到项目可控的本地 CSS 和图标资产，同时用三个视口复核视觉结果。

**验证方式**：运行 `npm run build`、`npm test`，打开真实管理服务，确认控制台无 CDN 警告、Network 中无外部资源请求，页面入口和视图切换正常。

**禁止事项**：不得为了消除一条 CDN 警告而在视觉复修阶段替换依赖、重写全局样式或改变 Stitch 视觉结果。

**相关文件或命令**：`design/stitch/18230660193198829480/06f8eaec0ace43eb91960233146f13c9/source.html`、`src/manager/public/index.html`、`npm test`。

**适用范围**：Stitch 产物使用运行时 Tailwind CDN 的 UI 壳承接阶段。

## task.json 和图片文件必须使用同级路径边界

**现象**：图片扫描已拒绝越界符号链接，但如果同目录的 `task.json` 是指向外部的符号链接，仍可能把外部项目名、提示词或归属信息带入索引。

**根因**：归属元数据也是扫描输入，不能因为它不是图片就只做字符串路径检查。

**正确做法**：对图片、`task.json` 和索引路径都执行 `lstat`、`realpath` 和受控根目录校验；符号链接元数据不得读取。

**验证方式**：运行 `tests/images/manager-domain.test.ts` 中的 task metadata symlink 用例，确认外部项目名和提示词未进入索引。

**禁止事项**：不得用 `readFile(join(imageDir, "task.json"))` 直接读取未验证元数据。

**相关文件或命令**：`src/images/manager-attribution.ts`、`src/images/manager-scanner.ts`、`npm test`。

**适用范围**：所有从本地输出目录读取任务归属信息的扫描、索引和恢复流程。

## 共享输出根目录不能在扫描后强制改写 Profile 归属

**现象**：不同 Profile 的任务使用同一图片输出根时，若扫描全部文件后统一写入当前 `profileId`，会在图片管理中串图。

**根因**：文件物理路径只证明它在受控输出根内，不证明它属于当前 Profile。

**正确做法**：任务创建时把 `profileBinding` 快照写入 `task.json`；扫描时只纳入绑定到所选 Profile 的图片和任务状态。旧未绑定任务只能由显式 legacy Profile 兼容。

**验证方式**：在同一输出根创建 A/B 两个绑定任务，分别扫描后确认每个索引只包含自己的文件与无文件任务状态。

**禁止事项**：不得以“当前正在查询 Profile A”为由，将根目录所有记录的 `profileId` 改成 A。

**相关文件或命令**：`src/profiles/binding.ts`、`src/tasks/model.ts`、`src/images/manager-attribution.ts`、`src/images/manager-scanner.ts`、`tests/images/manager-domain.test.ts`。

**适用范围**：多 Profile 共享输出根目录的图片管理、恢复、统计和导出功能。

## 并发构建不能同时覆盖同一前端资产目录

**现象**：`npm test` 和 `npm run build` 并发时，两个 `cp(..., { recursive: true, force: true })` 互相删除 Font Awesome 目标文件，其中一个构建以 `ENOENT unlink .../all.css` 失败。

**根因**：两个构建进程同时对 `src/manager/public/vendor/fontawesome/` 执行非原子递归覆盖。

**正确做法**：资产生成和目录复制必须受跨进程构建锁保护，并对异常退出遗留的过期锁执行有界恢复。

**验证方式**：并发启动两次 `npm run build:manager`，两者均必须退出 0，且本地 CSS 和 webfonts 完整存在。

**禁止事项**：不得假设 CI、多智能体或本地验证永远串行；不得在无锁时并发覆盖同一生成目录。

**相关文件或命令**：`scripts/copy-manager-assets.mjs`、`npm run build:manager`。

**适用范围**：所有会在构建和测试中生成或复制共享前端资产的流程。

## 筛选后的 total 不能代表 Profile 原始图库是否为空

**现象**：Profile 已有图片，但关键词或状态组合筛选返回 0 条时，页面误显示“该 Profile 暂无图片”。

**根因**：图片列表 API 的 `total` 表示当前查询条件下的结果总数；前端把 `total === 0` 当成未筛选图库为空，丢失了查询条件这一层语义。

**正确做法**：空结果文案由当前筛选条件决定。关键词、状态、格式、方向、项目、任务、生成类型、日期或尺寸任一非空时显示“没有符合当前筛选条件的图片”；只有没有实际筛选条件时才显示 Profile 空库文案。默认排序和分组不算筛选条件。

**验证方式**：运行 `tests/manager/ui-shell.test.ts` 的 IMG-4 用例，并在本地管理页面对有图片的 Profile 输入不匹配关键词，确认页面显示筛选无结果文案。

**禁止事项**：不得用筛选后的 `total` 推断未筛选图库总量；不得把默认排序或默认分组误判为活跃筛选。

**相关文件或命令**：`src/manager/public/ui-contracts.js`、`src/manager/public/app.js`、`tests/manager/ui-shell.test.ts`、`npm test`。

**适用范围**：图片管理空态、组合筛选、分页结果和所有查询后空结果提示。

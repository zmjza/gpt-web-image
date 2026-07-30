# Chrome 探测与能力检查

上级：[[_02-跨平台基础]]
下级：无
依赖：[[系统目录与路径规范]]

---

## 场景

首次安装或运行前确认 Google Chrome、Node、Playwright 和目录权限满足要求。

## 触发

`doctor`、`setup` 或任务启动前的快速检查。

## 逻辑

先使用显式配置，再搜索受支持系统的 Chrome Stable 标准位置；报告版本、架构、Profile 可写性、输出可写性和后台/可视启动能力。

## 状态 / 边界

不得静默改用用户未确认的其他浏览器。缺失依赖时返回可操作诊断，不自动下载未知二进制；版本最低要求在实现验证后写入。

## 当前实现

已创建 `src/platform/chrome.ts` 与 `src/commands/doctor.ts`，实现显式路径优先、macOS/Windows 标准路径候选、Node/架构/目录可写性报告和脱敏 doctor 结构；本机 Google Chrome 已用于本地夹具和完整 CLI 测试，但真实 ChatGPT 登录态尚未验证。

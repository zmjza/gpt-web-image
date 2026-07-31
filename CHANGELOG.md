# Changelog

## 0.2.0 - 2026-07-31

- 新增多 Profile 注册表、创建/导入/编辑、唯一启用、Plus/Pro/Go 资格检查、专用 Chrome 租约和任务 Profile 快照绑定。
- 新增默认目录扫描、迁移/保留、完整未加密备份、恢复为新 Profile 和页面专属二次删除确认。
- 新增只监听 `127.0.0.1` 的本地管理 API，完成 Profile、目录、备份、浏览器和图片管理 UI 的真实接线。
- 新增按 Profile 隔离的图片索引、增量扫描、组合筛选、排序、分组、分页、缩略图、详情、原图和导出；生成中/失败任务在无图片文件时仍可见。
- 图片和 `task.json` 扫描均拒绝符号链接越界；管理 API 采用字段白名单、错误脱敏且不提供图片删除能力。
- 将 Stitch 运行时 CDN 资源迁移为本地 Tailwind 和 Font Awesome 构建资产，完成桌面、平板和移动端管理界面。
- 本版未发布；macOS 真实 ChatGPT 资格/浏览器操作、本次 Windows CI 和 Windows x64 用户验收仍需后续实测。

## 0.1.1 - 2026-07-30

- 修复首次 Google/OpenAI 登录被判定为不安全浏览器：可视流程改用正式 Chrome、专用 Profile 和非零回环调试端口。
- 恢复 Chromium 沙箱，移除可视登录流程对 Playwright 自动化启动参数的依赖。
- 修复页面导航瞬间缺少 `document.body` 导致 setup 退出，并收紧 Cloudflare/Turnstile 验证识别，避免普通聊天文字误判。
- macOS 真机已确认专用 Profile Google 登录并由 `setup` 输出 `state=ready`；真实生图与回显验收仍待完成。

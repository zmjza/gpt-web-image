# Changelog

## 0.1.1 - 2026-07-30

- 修复首次 Google/OpenAI 登录被判定为不安全浏览器：可视流程改用正式 Chrome、专用 Profile 和非零回环调试端口。
- 恢复 Chromium 沙箱，移除可视登录流程对 Playwright 自动化启动参数的依赖。
- 修复页面导航瞬间缺少 `document.body` 导致 setup 退出，并收紧 Cloudflare/Turnstile 验证识别，避免普通聊天文字误判。
- macOS 真机已确认专用 Profile Google 登录并由 `setup` 输出 `state=ready`；真实生图与回显验收仍待完成。

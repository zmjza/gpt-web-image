# Changelog

## 0.2.6 - 2026-08-03

- 修复真实 ChatGPT 中文账户入口通过角色语义、`aria-label` 或无空格本地化文本暴露时的 Plus/Pro/Go 会员识别。
- 管理页面资格检查现在等待稳定 composer；生图控件暂未完成 hydration 时不再把已识别的合格会员误判为不合格。
- 增加魏邦 Plus、里燃未登录和延迟 hydration 的回归测试，并保留未登录/验证/技术失败的启用阻止边界。
- 记录真实连续修改在 `SUBMISSION_UNCERTAIN` 后只读确认并安全恢复的证据；本版未发布，最终 Windows CI、Windows x64 用户验收和 T42 发布门禁仍未执行。

## 0.2.5 - 2026-08-03

- 修复 ChatGPT 中文界面将 `你说：` 和 `展开收起` 展示控件拼入用户回合后造成的 `SUBMISSION_UNCERTAIN` 误判；提交指纹现在只比较去除这些 UI 包装后的真实消息文本。
- 增加该真实网页边界的回归测试；保持 `uncertain` 禁止盲目重提的安全策略不变。
- 补录真实双图歧义选择后的 refine 恢复交付证据；本版对应 Windows Actions run `30816483993` 已绿色，但未发布，Windows x64 用户验收和 T42 发布门禁仍未执行。

## 0.2.4 - 2026-08-03

- 只接受稳定 ChatGPT UUID 会话 URL，拒绝临时 `WEB:` 链接进入任务恢复锚点。
- 专用 Chrome 启动后显式导航到任务 URL，并按助手回合序号等待 DOM 挂载，避免恢复旧标签页或错图。
- 在提交点击边界捕获真实助手 `data-state`，避免跨平台导航时漏掉 `queued` 状态事件。
- 新增真实提交后中断恢复证据；本版未发布，T42 和 Windows x64 用户验收仍未执行。

## 0.2.3 - 2026-08-03

- 修复真实 `resume` 在 ChatGPT 会话 DOM 延迟挂载时过早读取助手回合的问题。
- 恢复 observer 现在按持久化 `assistantTurnOrdinal` 等待原助手回合出现后再继续监控；本版未发布，T42 和 Windows x64 用户验收仍未执行。

## 0.2.2 - 2026-08-03

- 修复 `resume` 对已确认提交任务只输出审计结果、不恢复网页监控的问题。
- 恢复时复用任务绑定的 Profile、原 ChatGPT 会话和助手回合锚点，禁止重复提交，并继续逐图交付剩余图片。
- 增加恢复 observer 集成回归测试；本版未发布，Windows x64 用户验收和 T42 发布门禁仍未执行。

## 0.2.1 - 2026-08-02

- 修复图片筛选无结果时误显示“该 Profile 暂无图片”，现在会与真实空 Profile 状态明确区分。
- 修复 CLI `--version` 硬编码旧版本，改为从 `package.json` 读取当前版本。
- 本版未发布；Windows x64 用户真机验收和 T42 发布门禁仍未执行。

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

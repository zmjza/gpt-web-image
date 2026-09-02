---
name: gpt-web-image
description: >-
  用作全局默认生图 Skill：当用户要求生成、画、创建、图生图或修改图片时使用，
  也支持 $gpt-web-image 显式调用。用户明确点名 $liran-image2、liran-image2、image2 或
  gpt-image-2 时不使用。不处理查看、分析、压缩、格式转换或仅讨论图片的请求。
---

# GPT 网页生图

## 三种任务必须区分

- **文生图**：只使用文字提示词生成新图，对应 `generate`。
- **图生图**：Codex 用户上传本地图片作为参考生成新图，对应 `edit --reference <绝对路径>`。没有参考图时必须失败，不能降级为文生图。
- **图改图**：修改本工具此前从 ChatGPT 网页生成并交付的指定图片，对应 `refine --task-id <源任务 ID> [--result-id <结果 ID>]`，必须复用源任务的稳定会话，不能使用本地附件替代。

此 Skill 通过项目 CLI 控制独立 Google Chrome Profile，只使用 ChatGPT 公开网页交互。首次运行 `setup` 时显示浏览器供用户自行登录；后续任务默认使用同一专用 Profile 启动正式 Chrome 并自动最小化到后台，不抢占当前前台窗口。只有登录失效、验证码或安全验证时才重新显示窗口供用户接管。不得读取密码、Cookie、令牌，不得绕过验证码、账号限制或内容政策。

## 触发边界

- 默认隐式触发：用户明确说生成、画、创建图片，或按参考图修改图片。
- 显式触发：`$gpt-web-image` 后跟自然语言要求。
- 路由让位：用户明确点名 `$liran-image2`、`liran-image2`、`image2` 或 `gpt-image-2` 时，改用 `liran-image2`。
- 不触发：查看、分析、描述、压缩、格式转换或仅讨论已有图片。

## 执行约定

1. 从本 Skill 目录的 `.gpt-web-image-install.json` 读取 `projectRoot`，使用 `node {projectRoot}/dist/src/cli.js` 调用 `setup/doctor/generate/edit/refine/resume/cancel/cleanup`；开发仓库内可直接运行 `node dist/src/cli.js`。默认专用 Profile 固定保存在 macOS `~/Library/Application Support/gpt-web-image/chrome-profile` 或 Windows `%LOCALAPPDATA%\\gpt-web-image\\chrome-profile`，位置也会在 `doctor/setup` 输出中显示；除非用户明确提出并确认，任何命令不得删除或重建该 Profile。
   - 用户提供本地图片时只走 `edit --reference <绝对路径>`，Skill 不得把本地图片请求翻译成 `generate` 或 `refine`。
   - `setup` 和人工接管使用可视窗口；登录完成或验证结束后会关闭该专用窗口。
   - 普通生图任务使用正式 Chrome 的 `--start-minimized` 后台窗口，不使用 `--headless`、全局 AppleScript 隐藏或控制用户个人 Chrome。台前调度模式下该窗口可能仍出现在 Chrome/台前调度的应用列表中，但不会覆盖当前操作。
2. 图改图请求有多张源图且未说明目标时，必须先要求用户指定结果编号或“全部”，不能自动选第一张；源图必须来自源任务的持久化 provenance。
3. CLI stdout 是 JSONL。每收到一条 `image_ready`，立刻用 `image.previewPath || image.originalPath` 的绝对路径输出 Markdown 图片：`![生成图片 X/N](/绝对路径)`，不得等到整批结束，也不能只回显路径文本。
4. 同一 `resultId` 或 `sha256` 只显示一次；终态核对 `completed/target`。部分失败不撤回已经显示的合格图片。
5. `LOGIN_REQUIRED` 或 `HUMAN_VERIFICATION_REQUIRED` 时，只能显示同一专用 Profile 供用户接管，不得自动填写凭据或验证码；提交不确定时禁止再次发送。
6. 用户要求 1–10 张时按目标数量执行，网页少产时最多补图 3 轮；超过轮次后如已有合格图片则明确报告部分成功。
7. 实际网页提交时直接使用 ChatGPT 当前已选模型；不读取、不打开、不切换或验证模型菜单。模型、额度或网页能力错误只按 ChatGPT 或 CLI 实际返回报告，不从菜单状态推断。
8. 同一 Profile 的多个任务允许跨进程并发进入持久化 FIFO 队列，但网页 Composer 始终串行操作。前一任务必须完成下载、解码、哈希、回显、task.json 和事件落盘后，才释放网页控制权。
9. 每个 `image_ready` 必须绑定当前任务、本轮用户回合、紧邻助手回合、唯一生成媒体卡和该卡的原图下载资源；历史图、附件、隐藏副本、缩略图或任意 `currentSrc` 均不得作为兜底。
10. 只有 CLI 明确返回 `LOGIN_REQUIRED`、`HUMAN_VERIFICATION_REQUIRED` 或 ChatGPT 明确的额度错误时，才能按对应状态提示用户；不得把普通页面结构变化归因为登录失效或额度耗尽。

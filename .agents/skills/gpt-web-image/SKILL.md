---
name: gpt-web-image
description: >-
  通过用户专用 Google Chrome Profile 调用 ChatGPT 网页完成文字生图、参考图改图和连续修改；
  支持自然语言隐式触发与 $gpt-web-image 显式触发。仅在用户明确要求生成、画、创建或修改图片时触发，
  不处理查看、分析、压缩或仅讨论图片的请求。
---

# GPT 网页生图

此 Skill 通过项目 CLI 控制独立 Google Chrome Profile，只使用 ChatGPT 公开网页交互。首次运行 `setup` 时显示浏览器供用户自行登录；后续任务默认在后台运行。不得读取密码、Cookie、令牌，不得绕过验证码、账号限制或内容政策。

## 触发边界

- 隐式触发：用户明确说生成、画、创建图片，或按参考图修改图片。
- 显式触发：`$gpt-web-image` 后跟自然语言要求。
- 不触发：查看、分析、描述、压缩、格式转换或仅讨论已有图片。

## 执行约定

1. 从本 Skill 目录的 `.gpt-web-image-install.json` 读取 `projectRoot`，使用 `node {projectRoot}/dist/src/cli.js` 调用 `setup/doctor/generate/edit/refine/resume/cancel/cleanup`；开发仓库内可直接运行 `node dist/src/cli.js`。
2. 请求有多张来源图且未说明目标时，必须先要求用户指定编号或“全部”，不能自动选第一张。
3. CLI stdout 是 JSONL。每收到一条 `image_ready`，立刻用 `image.previewPath || image.originalPath` 的绝对路径输出 Markdown 图片：`![生成图片 X/N](/绝对路径)`，不得等到整批结束，也不能只回显路径文本。
4. 同一 `resultId` 或 `sha256` 只显示一次；终态核对 `completed/target`。部分失败不撤回已经显示的合格图片。
5. `LOGIN_REQUIRED` 或 `HUMAN_VERIFICATION_REQUIRED` 时，只能显示同一专用 Profile 供用户接管，不得自动填写凭据或验证码；提交不确定时禁止再次发送。
6. 用户要求 1–10 张时按目标数量执行，网页少产时最多补图 3 轮；超过轮次后如已有合格图片则明确报告部分成功。

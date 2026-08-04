# Windows 用户真机验收

上级：[[_10-验证发布]]
下级：无
依赖：[[Windows-CI]]、[[09-真机实测]]

---

## 场景

Windows CI 无法证明真实 ChatGPT 登录、生图和 Codex 宿主回显。

## 本轮范围

目标文件开头已明确：Windows x64 用户验收先不做，默认真机测试通过。本轮不启动 Windows 设备、不代填凭据、不生成用户验收截图；以下步骤保留给未来需要真实双平台证据时使用。当前“默认通过”是范围决定，不是实际 Windows 操作证据。

## 触发

Windows CI 通过且发布候选安装包/Skill 准备完毕。

## 逻辑

当前不创建安装包或 Release；未来若取消本轮豁免，可使用固定 Git 提交源码候选，在 Windows x64 真机按 6.1–6.5 顺序验收。先执行 `npm ci`、`npm run build`、`npm run install:user`、`doctor` 和 `setup`，再验证首次登录、最小化后台 1 张、多图逐张回显、参考图改图和文件路径。真实验收时每一步必须由用户在 Windows 机器上实际观察并明确反馈；Codex 不代替用户填写账号凭据，也不把 Windows CI、macOS 真机或本地夹具结果写成用户通过。

## 当前候选

- 分支：`codex/manager-internal-closure`
- 固定提交：`401b2834b3ac762b49f73c2ae6b321287acc9051`（版本 `0.2.13`，范围收口候选）
- 源码地址：<https://github.com/zmjza/gpt-web-image/tree/codex/manager-internal-closure>
- Windows CI：run `30902048432` / job `91968381639`，<https://github.com/zmjza/gpt-web-image/actions/runs/30902048432>
- 证据边界：该 CI 已覆盖跨平台代码、安装、Chrome 探测、锁/进程、夹具、下载、事件、恢复、清理和安全测试，但不包含真实 ChatGPT 登录和 Windows Codex 宿主回显。

## 最短步骤

在 PowerShell 中执行：

```powershell
git clone https://github.com/zmjza/gpt-web-image.git
Set-Location gpt-web-image
git checkout 401b2834b3ac762b49f73c2ae6b321287acc9051
npm ci
npm run build
npm run install:user
node dist/src/cli.js doctor --json
node dist/src/cli.js setup
```

首次 `setup` 会打开项目专用 Chrome Profile。用户自行完成 Google/ChatGPT 登录、会员验证和验证码；不要把密码、Cookie、Token、验证码或完整浏览器日志发给 Codex。专用 Profile 默认位于 `%LOCALAPPDATA%\\gpt-web-image\\chrome-profile`，只能使用该目录，不能接管或替换个人 Chrome Profile。登录完成后应保持该目录，不得手动删除；后续任务使用同一 Profile 的正式 Chrome 最小化后台模式。

## 预期结果

1. `doctor --json` 能发现 Chrome、专用 Profile 和可写目录，输出不含认证数据。
2. `setup` 在专用窗口完成登录后返回 `state=ready`；重启或再次检查仍复用同一 Profile。
3. 6.2 的 1 张生图成功下载并在当前 Codex 对话显示真实图片和绝对路径，文件可打开。
4. 6.3 的多图在生成过程中逐张显示，第一张早于整批终态；不重复、不串图。
5. 6.4 的参考图源文件不被覆盖，输出图单独保存且可打开；历史版本仍存在。
6. 6.5 只有在 6.1–6.4 全部由用户确认通过后，才能把 T41 标记为“用户验收通过”。

## 脱敏反馈模板

请只反馈以下字段：

```text
Windows 版本：
Node/npm 版本：
固定提交：
通过步骤：6.1 / 6.2 / 6.3 / 6.4
失败命令或步骤：
脱敏错误码或简短现象：
是否需要复测：是 / 否
```

截图只能脱敏后提供，避免包含账号、邮箱、页面 Cookie、Token、验证码、完整 URL 查询参数或完整浏览器日志。

## 失败复测

失败时先保留任务目录和脱敏错误码，不删除专用 Profile、任务数据或图片。Codex 根据失败步骤回写 `liran_docs/09-真机实测.md`、`liran_docs/04-开发追踪.md` 和相关避坑条目，修复后只重跑受影响步骤并回归 6.1–6.5；未收到新的明确反馈前，状态继续保持“待用户验收”。

## 状态 / 边界

本轮按用户范围保持 `豁免/默认通过（无真机证据）`，不能把该状态描述成实际 Windows 真机或用户反馈。Codex 不伪造用户反馈或远程操作不存在的 Windows 设备。未来验收不得提交密码、Cookie、Token、验证码或完整敏感日志；专用 Profile 默认位于 `%LOCALAPPDATA%\\gpt-web-image\\chrome-profile`，不得删除或替换个人 Chrome Profile。

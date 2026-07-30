# 浏览器会话与认证安全

## 不要复用日常 Chrome Profile 或自动处理认证

**现象**：项目需要借助用户已登录的 ChatGPT Plus 网页完成生图；首次登录需要可视化浏览器，后续任务希望后台运行，登录失效或验证时还要恢复可视操作。

**根因**：日常 Profile 可能包含无关标签页和账号数据；自动填写密码、验证码、Cookie 或令牌会扩大权限边界，也无法安全证明登录已经完成。

**正确做法**：只使用 Skill 专用、可持久化的 Chrome Profile。`setup` 首次以可视模式打开页面，由账号所有者自行完成登录、验证码或安全验证；正常任务使用后台模式；检测到登录失效时复用同一 Profile 切换到可视模式，并保持原任务状态和提交尝试不变。

**验证方式**：运行 `doctor` 检查 Chrome、Profile、目录和锁；运行 `setup` 后确认可交互输入区稳定存在，再确认后台检查可以复用专用 Profile。真实账号登录尚未由本次文档回填代替，必须按 `liran_docs/09-真机实测.md` 记录真实证据。

**禁止事项**：不得访问或结束用户日常 Chrome；不得读取、记录或自动填写密码、Cookie、Token、验证码；不得仅凭页面跳转或短暂输入框出现就判定登录成功；不得在登录状态不确定时重复提交网页任务。

**相关文件或命令**：`.agents/skills/gpt-web-image/SKILL.md`、`src/browser/profile.ts`、`src/browser/login.ts`、`src/browser/handoff.ts`、`src/browser/profile-lock.ts`、`node dist/src/cli.js doctor --json`、`node dist/src/cli.js setup`。

**适用范围**：macOS ARM64 和 Windows x64 的首次安装、后台运行、人工验证接管和恢复流程。

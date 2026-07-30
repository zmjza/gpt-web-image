# 浏览器会话与认证安全

## 不要复用日常 Chrome Profile 或自动处理认证

**现象**：项目需要借助用户已登录的 ChatGPT Plus 网页完成生图；首次登录需要可视化浏览器，后续任务希望后台运行，登录失效或验证时还要恢复可视操作。

**根因**：日常 Profile 可能包含无关标签页和账号数据；自动填写密码、验证码、Cookie 或令牌会扩大权限边界，也无法安全证明登录已经完成。

**正确做法**：只使用 Skill 专用、可持久化的 Chrome Profile。`setup` 首次以可视模式打开页面，由账号所有者自行完成登录、验证码或安全验证；正常任务使用后台模式；检测到登录失效时复用同一 Profile 切换到可视模式，并保持原任务状态和提交尝试不变。

**验证方式**：运行 `doctor` 检查 Chrome、Profile、目录和锁；运行 `setup` 后确认可交互输入区稳定存在，再确认后台检查可以复用专用 Profile。真实账号登录只能按 `liran_docs/09-真机实测.md` 记录真实证据，本次 macOS setup 已输出 `state=ready`。

**禁止事项**：不得访问或结束用户日常 Chrome；不得读取、记录或自动填写密码、Cookie、Token、验证码；不得仅凭页面跳转或短暂输入框出现就判定登录成功；不得在登录状态不确定时重复提交网页任务。

**相关文件或命令**：`.agents/skills/gpt-web-image/SKILL.md`、`src/browser/profile.ts`、`src/browser/login.ts`、`src/browser/handoff.ts`、`src/browser/profile-lock.ts`、`node dist/src/cli.js doctor --json`、`node dist/src/cli.js setup`。

**适用范围**：macOS ARM64 和 Windows x64 的首次安装、后台运行、人工验证接管和恢复流程。

## Google 登录不要使用自动化端口 0

**现象**：普通 Google Chrome 已打开专用 Profile，但 Google 登录页显示“无法登录，此浏览器或应用可能不安全”；此前 `auth.openai.com` 的 Cloudflare 页面也可能长期停留。

**根因**：Chrome 使用 `--remote-debugging-port=0` 启动时会把 `navigator.webdriver` 标记为自动化状态；Playwright 持久化启动还会附带自动化启动参数。Google/OpenAI 风控会据此拒绝认证，即使浏览器窗口看起来是正式 Chrome。

**正确做法**：可视流程使用正式 Google Chrome 可执行文件、项目专用 `user-data-dir`、回环地址 `127.0.0.1` 和预先分配的非零随机调试端口；禁止 `--no-sandbox`、`--enable-automation` 和批量 `--disable-*` 参数。认证只由用户操作，成功后由 `setup` 通过稳定可交互输入区确认。

**验证方式**：检查启动命令只包含 `--user-data-dir`、`--remote-debugging-address=127.0.0.1`、非零 `--remote-debugging-port`、首次运行参数和目标 URL；运行 `node dist/src/cli.js setup`，用户完成 Google 登录后应输出 `{"state":"ready"}`。页面正文普通聊天内容含“验证”时不得被判为人机验证，真正 Cloudflare/Turnstile 页面才升级人工处理。

**禁止事项**：不得使用端口 `0`、`--enable-automation`、`--no-sandbox`、反检测脚本或伪造 User-Agent；不得自动点击/解决 Turnstile、填写 Google 凭据或读取 Cookie/Token；不得将系统 Chrome 窗口列表索引当作专用 Profile 身份。

**相关文件或命令**：`src/browser/profile.ts`、`src/browser/login.ts`、`src/chatgpt/web-flow.ts`、`node dist/src/cli.js setup`、`ps -axo pid,ppid,command`。

**适用范围**：macOS ARM64 和 Windows x64 的 Google/OpenAI 首次认证、Cloudflare 人工验证和后续后台复用。

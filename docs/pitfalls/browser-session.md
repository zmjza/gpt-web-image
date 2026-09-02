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

## 后台任务应最小化专用 Chrome，不要全局隐藏 Chrome

**现象**：macOS 开启台前调度后，后台生图若使用可视 Chrome，窗口可能抢到前台；若直接执行隐藏 Chrome 的系统脚本，又可能把用户正在使用的个人窗口一起隐藏。

**根因**：项目需要真实 Google Chrome 的账号会话和网页渲染，不能为了“无窗口”改用未经验证的 headless 或全局应用级隐藏操作；系统隐藏命令通常按应用而不是按本项目 Profile 区分窗口。

**正确做法**：首次登录和人工验证保持可视；普通任务用同一专用 Profile 启动正式 Chrome 并传入 `--start-minimized`，任务结束关闭该专用进程。台前调度模式下该窗口可能仍在应用列表中，但不得覆盖当前操作，也不得影响个人 Chrome。

**验证方式**：检查 `buildHeadedChromeArgs(..., true)` 包含 `--start-minimized` 且不包含 `--headless`、`--enable-automation`；确认 setup 可视完成后关闭，普通任务使用 `headed: false`，并检查专用 Profile 锁和 Chrome 子进程在结束后释放。macOS 台前调度下的真实视觉表现仍需在目标机器复测，不能用夹具代替。

**禁止事项**：不得执行针对整个 Google Chrome 应用的 AppleScript 隐藏；不得结束用户个人 Chrome；不得把“最小化”宣称为已验证的完全不可见；不得因台前调度而删除或重建 Profile。

**相关文件或命令**：`src/browser/profile.ts`、`tests/browser/session.test.ts`、`.agents/skills/gpt-web-image/SKILL.md`、`node dist/src/cli.js setup`、`node dist/src/cli.js generate`。

**适用范围**：macOS 台前调度和 Windows 多窗口环境下的专用 Profile 后台任务。

## macOS 不能只依赖 --start-minimized 或 CDP bounds

**现象**：macOS 正式 Chrome 使用 `--start-minimized` 启动后，CDP `Browser.getWindowBounds` 仍报告 `windowState=normal`；继续导航也可能让窗口回到前台，影响台前调度。

**根因**：当前 Chrome macOS 版本会忽略 CDP `Browser.setWindowBounds(windowState=minimized)` 的状态写入；命令行最小化参数也不保证 Accessibility 窗口状态。

**正确做法**：后台启动完成目标 URL 导航后，在当前页面临时设置一次随机 UUID 标题；通过 `osascript` 遍历 Chrome 窗口中的标签页，只将标题完全匹配的专用窗口设为 `visible=false`，随后恢复原页面标题。Windows/其他平台使用 CDP 窗口最小化。任何定位失败都让任务失败并释放专用进程/锁，不静默显示窗口。

**验证方式**：隔离 Chrome 窗口集成测试 13/13 通过；真实魏邦 Profile 只打开 ChatGPT、不提交任务，唯一标记窗口返回 `matched=true, visible=false`，关闭后项目 Chrome/锁为 0。真实日常 Chrome 不按应用级 AppleScript 操作。

**禁止事项**：不得按整个 Google Chrome 应用隐藏、最小化或退出；不得用固定窗口序号、坐标或用户窗口标题猜测目标；不得把 `--start-minimized` 或 CDP 返回成功当作 macOS 已隐藏证据。

**相关文件或命令**：`src/browser/profile.ts`、`tests/integration/web-flow.test.ts`、`node dist/src/cli.js generate`、`ps -axo pid,ppid,command`。

**适用范围**：macOS 台前调度、真实 ChatGPT 后台生图、人工接管和专用 Chrome 生命周期。

## 普通 Chrome 的登录不会迁移到专用 Profile

**现象**：用户记得已经在 Chrome 登录，但项目专用页面仍显示“登录/免费注册”；专用目录和 Chrome 文件仍存在，普通 Chrome 也可能同时打开多个个人资料。

**根因**：项目通过 `--user-data-dir` 使用独立 Profile。普通 Chrome 的个人资料、Cookie 和 ChatGPT 会话与该目录隔离；本次真实检查只能证明专用页面当前处于访客态，无法仅凭文件时间判断服务端会话是否过期，具体失效原因信息不全，待人工补充。

**正确做法**：只在项目启动的专用 Chrome 窗口中完成一次登录。固定保存位置由 `doctor/setup` 的 `profile.path`/`profileDir` 输出确认，根目录 `.gpt-web-image-profile.json` 记录 `profileDir` 和 `retentionPolicy=never-auto-delete`。正常关闭只释放锁，后台任务复用同一目录。

**验证方式**：确认专用 Chrome 启动参数含目标 `--user-data-dir`；检查页面无登录控件、存在稳定的已登录 composer；运行 `doctor --json` 查看 `profile.path`、`profile.markerPath` 和 `profile.retentionPolicy`；确认 Profile 目录仍存在且 cleanup 对其路径拒绝执行。

**禁止事项**：不得把普通 Chrome 的登录当作专用 Profile 已登录；不得删除、重建或清空 Profile；不得读取 Cookie、Token、密码或验证码来判断会话。

**相关文件或命令**：`src/config/schema.ts`、`src/browser/profile.ts`、`src/commands/doctor.ts`、`src/diagnostics/cleanup.ts`、`node dist/src/cli.js doctor --json`、`node dist/src/cli.js setup`。

**适用范围**：macOS ARM64 和 Windows x64 的首次登录、会话复用、登录失效接管和清理操作。

## 恢复任务不能保存临时 WEB 会话链接或沿用旧标签页

**现象**：真实 ChatGPT 提交确认阶段可能短暂出现 `https://chatgpt.com/c/WEB:...`，直接重开会话会跳回首页；Chrome 重新启动还可能恢复上次旧会话页，导致恢复任务找不到原助手回合或观察错会话。

**根因**：临时会话标识尚未稳定为侧栏中的 UUID URL；专用 Profile 的 Chrome 会话恢复也不保证启动参数 URL 覆盖已恢复标签页。

**正确做法**：只接受稳定的 `https://chatgpt.com/c/<UUID>` 作为 `chatUrl`，临时 `WEB:` 链接不得写入任务锚点；启动后显式导航到任务要求的 URL，再按 `assistantTurnOrdinal` 等待原助手回合挂载。

**验证方式**：真实任务 `task_msc136ro_76vi3ms0` 在提交确认后中断，`resume` 复用稳定 UUID 会话并交付 PNG；文件、任务哈希和 `image_ready` 一致，终态 `succeeded`，没有第二次提交。

**禁止事项**：不得把 `WEB:` 临时链接当作可恢复会话；不得依赖 Chrome 恢复的旧标签页；不得在恢复失败时默认新建会话或重复发送提示词。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`src/browser/profile.ts`、`src/cli.ts`、`node dist/src/cli.js resume`。

**适用范围**：真实 ChatGPT 提交确认、连续修改、提交后中断恢复和 Profile 重启。

## 会员检测不能依赖单一生图控件或英文账户入口

**现象**：真实 ChatGPT 中文页面已经登录 Plus，但管理页面把 Profile 判为技术失败或不合格；账户入口只出现在带本地化 `aria-label` 的角色元素中，生图控件还未完成 hydration 时暂时不存在。

**根因**：页面不同阶段和语言环境下，会员等级可能通过账户菜单文本、可访问名称或拼接后的本地化文本暴露；将“当前没有生图按钮”当作能力为 false，会把暂态 DOM 缺失误判为会员不合格。

**正确做法**：先等待稳定、可交互的 composer，再读取可见 `role`/`aria-label`/`title` 账户入口和菜单文本；支持 Plus、Pro、Go 的本地化及无空格信号。生图控件未出现时记录未知能力，不覆盖已经可靠识别的合格会员。只有明确未登录、验证接管、其他会员或技术检测失败才禁止启用。

**验证方式**：真实魏邦专用 Profile 返回 `logged_in / plus / eligible=true`；真实里燃 Profile 返回 `needs_login`，启用返回 `LOGIN_REQUIRED` 且 active 不变。会员回归测试 6/6、管理服务延迟 hydration 回归 7/7；检测结束后专用 Chrome 进程和 lease 锁均为 0。不要在文档或日志中记录认证数据。

**禁止事项**：不得只用英文 CSS 文本、单一按钮选择器或固定延时判断会员；不得因为暂时找不到生图控件否定 Plus/Pro/Go；不得以普通 Chrome 登录状态替代受管 Profile；不得读取密码、Cookie、Token 或验证码。

**相关文件或命令**：`src/browser/membership.ts`、`src/manager/server.ts`、`tests/browser/membership-lease.test.ts`、`tests/manager/server.test.ts`、`node dist/src/cli.js doctor --json`。

**适用范围**：macOS ARM64 和 Windows x64 的 Profile 资格检测、管理页面启用前检查及登录态 hydration 延迟场景。

## 中断后项目锁必须按归属与 PID 校验回收

**现象**：任务进程在专用 Chrome 已启动、但网页提交尚未建立 `attemptId` 时被中止，Profile 锁和 BrowserLease 文件可能仍存在；此时专用 Chrome 已退出，锁内 PID 也已失效。

**根因**：进程被外部信号终止时，正常 `finally` 清理不一定执行；锁文件是持久化保护证据，不能仅凭“文件存在”或“看起来是旧的”直接删除。

**正确做法**：先检查专用 Profile 参数对应的 Chrome 进程确实不存在，再解析锁记录，确认 schema、owner、Profile 路径、任务归属和 PID 已退出；通过项目锁/租约实现执行一次受控 acquire/release 回收，最后用 `doctor --json` 和文件检查确认锁消失、Profile 内容未被删除或重建。

**验证方式**：真实任务 `task_msdc213z_k2pwi2ti` 中断时 `attemptId/clickedAt/confirmedAt` 均为空；`resume` 返回 `resume_before_submit` 且未执行网页写操作。仅在确认 PID 已退出后回收锁，随后 `doctor --json` 仍报告专用 Profile 可写和 `retentionPolicy=never-auto-delete`。

**禁止事项**：不得按文件名批量删除锁；不得结束用户日常 Chrome；不得在 PID 仍存活、Profile 路径不匹配或归属无法验证时回收；不得把锁清理误写成任务已提交或图片生成成功。

**相关文件或命令**：`src/browser/profile-lock.ts`、`src/browser/browser-lease.ts`、`src/cli.ts`、`node dist/src/cli.js resume`、`node dist/src/cli.js doctor --json`、`ps -axo pid,ppid,command`。

**适用范围**：macOS ARM64 和 Windows x64 的提交前/提交后中断、恢复、取消和专用 Chrome 生命周期。

## macOS Chrome 标签标题传播需要有限轮询

**现象**：后台专用 Chrome 已连接且页面脚本刚设置随机标题，但 AppleScript 立即扫描标签页时可能返回找不到专用窗口；并行测试中出现低概率失败。

**根因**：浏览器协议中的 `document.title` 更新与 macOS Chrome AppleScript 窗口模型不是同步可见的，单次查询存在传播竞态。

**正确做法**：只对带随机 UUID 标记的目标标签执行有界轮询；命中后隐藏该窗口并恢复原标题，超出预算仍安全失败并关闭专用进程。不能退化为全局隐藏 Chrome。

**验证方式**：`tests/browser/session.test.ts` 模拟前两次返回 false、第三次返回 true；`tests/integration/web-flow.test.ts` 真实 Chrome 集成 13/13 通过；真实魏邦 Profile 无提交窗口返回 `visible=false`，锁和 lease 为 0。

**禁止事项**：不得固定延时无限等待；不得按窗口索引或标题模糊匹配其他 Chrome；不得在定位失败时留下进程、锁或临时标题。

**相关文件或命令**：`src/browser/profile.ts`、`hideMacWindowByTitle`、`npm test`、`node --test dist/tests/integration/web-flow.test.js`。

**适用范围**：macOS 台前调度、后台任务启动、窗口隐藏和专用 Chrome 关闭/重开。

## macOS 隐藏轮询期间 SPA 可能重写临时标题

**现象**：专用 Chrome 已连接并导航到正确稳定会话，但后台最小化仍在有界等待后报“找不到专用 Chrome 窗口”；任务尚未执行恢复观察，进程和锁被安全释放。

**根因**：只在 AppleScript 轮询前设置一次随机 `document.title` 不够。ChatGPT SPA 会在路由或数据 hydration 时重写标题，导致后续每次精确查询都看不到随机标记；单纯延长等待时间无效。

**正确做法**：每次有界 AppleScript 精确查询前，在目标 Playwright page 上重新写入同一个随机 UUID 标题；命中后只隐藏包含该精确标题标签页的窗口，并恢复原标题。重写或定位失败仍关闭本次专用 Chrome 并释放 Profile 锁。

**验证方式**：新增回归测试确认每次查询前都执行标题重写；真实 `task_msiq8jlw_k1xot6vo` 恢复在旧逻辑失败，修复后进入原稳定会话并完成只读下载，未重新提交提示词。

**禁止事项**：不得因此模糊匹配标题、按窗口序号操作、隐藏整个 Chrome 应用或控制用户个人 Chrome；不得无限重试或忽略最小化失败。

**相关文件或命令**：`src/browser/profile.ts`、`tests/browser/session.test.ts`、`node dist/src/cli.js resume --task-id <taskId>`。

**适用范围**：macOS ChatGPT SPA、后台任务启动、提交后恢复和精确窗口隐藏。

## 跨进程 FIFO 的短时互斥锁也必须回收死进程

**现象**：任务进程在更新持久化队列的极短临界区崩溃后，`.json.lock` 保留；后续任务即使 active PID 已退出，也全部在 `PROFILE_QUEUE_LOCK_TIMEOUT` 失败。

**根因**：队列 active 记录已有死进程判断，但保护队列文件本身的短时互斥锁没有同等回收逻辑，导致一次崩溃影响同 Profile 后续所有任务。

**正确做法**：互斥锁写入固定 schema、PID 和随机 token；遇到已存在锁时只在结构可验证且 PID 明确退出时回收。无法验证或 PID 仍存活时不得删除，继续有界等待并失败。

**验证方式**：测试预置项目归属明确、PID 已退出的队列锁；修复前超时，修复后下一任务可 enqueue、取得执行权并释放。原有同进程和两个独立 Node 进程 FIFO 测试继续通过。

**禁止事项**：不得按文件名无条件删除锁；不得回收存活 PID 或结构不明的锁；不得触碰 Profile 锁、BrowserLease 或用户个人 Chrome。

**相关文件或命令**：`src/tasks/profile-queue.ts`、`tests/tasks/profile-queue.test.ts`、`npm test`。

**适用范围**：同 Profile 多 Codex 对话、进程异常退出、队列恢复和串行网页提交。

## 管理服务重启必须恢复陈旧的浏览器状态

**现象**：管理服务或浏览器进程异常退出后，Profile 注册表可能仍保存 `browserStatus=open`；实际没有项目专用 Chrome、Profile 锁或 BrowserLease，页面却继续显示“运行中”。

**根因**：浏览器状态写入注册表与进程/lease 生命周期不是同一个原子操作；异常退出时正常的 `close` 回写可能没有执行。仅凭注册表字段不能证明浏览器仍在运行。

**正确做法**：管理服务启动时读取唯一 BrowserLease，只有 lease 记录的 PID 仍存活时才保留对应 Profile 的 `open` 状态；其余陈旧 `open` 状态恢复为 `closed`。不要触碰 Profile 内容，也不要清理 `task_busy` 或用户日常 Chrome。

**验证方式**：先在 `tests/manager/server.test.ts` 将 Profile 状态设为 `open`，关闭服务且不创建 lease，再重启服务并读取 `/api/profiles`，状态应为 `closed`；真实复测同时检查 `ps`、Profile 锁、BrowserLease 和 `doctor --json`。

**禁止事项**：不得手工改真实注册表来掩盖问题；不得按 Chrome 应用进程总数判断项目浏览器；不得因为状态陈旧而删除、迁移、覆盖或重建 Profile；不得清理仍由存活 lease 持有的 Profile。

**相关文件或命令**：`src/browser/browser-lease.ts`、`src/manager/server.ts`、`src/profiles/manager.ts`、`tests/manager/server.test.ts`、`ps -axo pid,ppid,command`、`node dist/src/cli.js doctor --json`。

**适用范围**：macOS ARM64 和 Windows x64 的管理服务重启、异常退出、专用浏览器生命周期和多 Profile 状态展示。

## BrowserLease 并发冲突必须保留明确的 API 错误码

**现象**：两个管理页面请求同时检查同一 Profile 时，一个请求正常完成，另一个请求因专用浏览器租约已被占用而失败；如果服务端错误白名单漏掉 `BROWSER_LEASED`，客户端只能收到脱敏的 500 `INTERNAL_ERROR`，无法区分可重试的资源冲突。

**根因**：`BrowserLeaseError` 携带了 `BROWSER_LEASED` code，HTTP 状态映射已经定义为 409，但 `safeError()` 的已知错误集合没有包含该 code，导致错误码被降级为通用 500。

**正确做法**：所有由租约层定义并在 HTTP 状态映射中声明的冲突 code，都必须同时加入服务端安全错误白名单；返回 409 和脱敏 code，不暴露锁文件、PID、Profile 内容或认证数据。

**验证方式**：并发调用同一 Profile 的 `/api/profiles/:profileId/check`，一个响应为 200，另一个响应为 409 且 `error.code=BROWSER_LEASED`；运行 `node --test --test-concurrency=1 dist/tests/manager/server.test.js`。

**禁止事项**：不得把租约冲突伪装成登录失败或成功；不得为了消除 500 绕过 BrowserLease、启动第二个专用 Chrome、自动重试网页提交或输出租约内部数据。

**相关文件或命令**：`src/browser/browser-lease.ts`、`src/manager/server.ts`、`tests/manager/server.test.ts`、`/api/profiles/:profileId/check`。

**适用范围**：Profile 资格检查、打开浏览器、后台生图和任何共享专用 Chrome 的管理 API 并发请求。

## 管理页的启用、检测和打开不能复用同一个 UI 语义

**现象**：Profile 列表把“启用”“检测状态”和“打开浏览器”都实现为打开浏览器或只改一个状态字段，切换 Profile 后旧浏览器仍占用，页面 active 与实际浏览器不一致。

**根因**：启用是资格检查后的唯一 active 切换；检测是受控后台会话读取登录/会员/Chrome 状态；打开是用户主动使用项目浏览器。三者的副作用和生命周期不同。

**正确做法**：启用前检查 `pathStatus`、登录和 Plus/Pro/Go，切换前关闭旧项目浏览器并保持唯一 active；检测只更新检查结果，不改变 active 或手动浏览器状态；打开/关闭只操作项目拥有的浏览器，并用 `closing` 状态防止重复关闭。

**验证方式**：隔离页面 E2E 依次启用两个 Profile，断言始终只有一个 active；打开/关闭后断言浏览器状态、Profile 锁和 BrowserLease 均清理；真实 macOS 魏邦检测返回 `logged_in / plus`，里燃未登录时 active 不变。

**禁止事项**：不得把检测成功当成启用成功；不得打开一个 Profile 时隐式切换 active；不得按应用级别关闭用户日常 Chrome；不得在关闭异常时遗留 lease/锁或吞掉错误。

**相关文件或命令**：`src/manager/server.ts`、`src/profiles/manager.ts`、`tests/manager/server.test.ts`、`/tmp/gwi-manager-isolated-e2e.mjs`、`npm test`。

**适用范围**：macOS/Windows Profile 管理页面、唯一启用、资格检测和专用 Chrome 生命周期。

## 嵌套模型菜单的父节点不是最终模型选项

> **0.5.0 起的现行策略**：模型菜单自动化已禁用。提交流程不再查询、打开、切换或验证任何模型/能力控件，直接使用 ChatGPT 当前已选模型。以下内容仅保留为 0.4.0 历史根因记录。

**现象**：真实图生图任务在提交前失败；一次 `locator.click` 等待可见 `role=menuitem` 时被 `thread-bottom-container` 拦截 30 秒，另一次打开菜单后返回 `MODEL_SELECTION_UNCERTAIN`。任务没有 `clickedAt`、`confirmedAt` 或 `chatUrl`，参考图证据已正常落盘。

**根因**：ChatGPT 把模型能力入口改成 Radix 嵌套子菜单。父节点带 `data-has-submenu`、`aria-haspopup=menu` 和混合的高/中/极速文本；旧分类器优先匹配其中的“极速”，误把整个父节点当成最终选项，再用容易被底部覆盖层拦截的指针点击操作它。扁平菜单夹具没有覆盖该结构。

**正确做法**：模型标签只有在唯一指向一个模型时才能分类；优先读取当前可见能力 group 内的唯一 slider，同时接受“思考强度”和当前“推理强度”文案。带子菜单语义的节点只用于导航，且只能在刚打开的模型 `role=menu` 内查找，不能全页匹配侧栏“高棉语”等文本。模型选择证据不明确时继续禁止提交，不能用强制点击绕过命中测试。

**验证方式**：`tests/chatgpt/model-selection.test.ts` 断言混合父节点返回 `null`；`tests/fixtures/chatgpt-page/index.html` 覆盖 `nested-capability`、侧栏干扰和 `localized-capability`；`tests/integration/web-flow.test.ts` 断言最终选择 `GPT-5.6 Sol 高`。真实任务 `task_mt78uzxk_xu73ll7q` 的 `modelSelection` 已记录高模型并完成提交和交付。

**禁止事项**：不得把父菜单文本中的任一关键词当成最终选择；不得对被遮挡元素使用未验证的 `force` 点击；不得把 `MODEL_SELECTION_UNCERTAIN` 推断为登录失效或额度耗尽；不得在提交状态不明确时盲目重试。

**相关文件或命令**：`src/chatgpt/model-selection.ts`、`tests/chatgpt/model-selection.test.ts`、`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`、`node dist/src/cli.js edit`。

**适用范围**：ChatGPT 模型/能力菜单改版、Radix 子菜单、后台最小化 Chrome、文生图、图生图和图改图的提交前模型门禁。

## Profile 路径健康状态必须在展示和动作前复核

**现象**：注册表中的 Profile 路径被移动、替换或变成普通 Chrome 目录后，页面仍显示可用，检测/启用/打开可能操作错误目录。

**根因**：注册表是持久化索引，不等于当前目录仍存在且保留项目归属标记；只在导入时检查会漏掉后续外部变化。

**正确做法**：列表返回脱敏的 `pathStatus`，动作执行前重新检查目录、标记路径、owner、schema 和读写权限；非 `ok` 返回 `PROFILE_PATH_INVALID`，不得启动浏览器。

**验证方式**：隔离 E2E 导入普通目录必须失败；管理服务路径异常回归返回 422；真实魏邦返回 `pathStatus=ok`，`doctor --json` 的 marker 和保留策略仍存在。

**禁止事项**：不得用字符串前缀代替归属校验；不得为修复路径状态自动删除、迁移或重建真实 Profile；不得把绝对认证路径写入页面日志。

**相关文件或命令**：`src/profiles/manager.ts`、`src/manager/server.ts`、`tests/profiles/directories.test.ts`、`node dist/src/cli.js doctor --json`。

**适用范围**：Profile 扫描、管理 API、页面操作和跨平台路径迁移前置检查。

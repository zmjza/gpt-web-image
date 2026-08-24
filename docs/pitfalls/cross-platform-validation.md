# 跨平台验证与证据边界

## 不要把本地夹具或单个平台结果写成双平台真实通过

**现象**：本地单元测试和 Chrome 夹具可以覆盖状态机、下载、恢复与 JSONL；但真实 ChatGPT、Windows `windows-latest` CI、macOS 真机和 Windows x64 用户环境仍是不同验收层。

**根因**：夹具没有真实账号和真实 ChatGPT DOM；CI 不能证明用户登录或 Codex 宿主回显；macOS 真机不能证明 Windows x64；用户未反馈时也没有 Windows 真机证据。

**正确做法**：按门禁顺序记录证据：内部命令与夹具先完成；T39 Windows CI 绿色后才能进入 T40 macOS 真实 ChatGPT 验收；T41 Windows x64 用户验收在用户明确反馈前保持“待用户验收”。每项通过立即把真实证据、版本/环境和结果写入 `liran_docs/09-真机实测.md`，失败先回写问题、修复后复测。

**验证方式**：内部验证至少运行 `npm run typecheck`、`npm test`、`npm run build` 和可用的安全检查；CI 读取真实 Actions 日志；macOS 验收检查专用 Profile、真实文件、事件顺序和 Codex 回显；Windows 用户验收只接受用户明确文字反馈。结构校验命令为 `python3 scripts/check_real_test_checklist.py liran_docs/09-真机实测.md --require-complete`（仅校验表格门禁，不证明操作发生）。

**禁止事项**：不得伪造 GitHub Actions、真实 ChatGPT、macOS 真机、Windows 用户反馈或截图证据；不得因本地测试通过就标记真机通过；不得跳过 T39 直接进入 T40；不得在 T41 未通过时声明双平台完成或执行发布。

**相关文件或命令**：`liran_docs/04-开发追踪.md`、`liran_docs/08-测试用例.md`、`liran_docs/09-真机实测.md`、`liran_docs/modules/10-验证发布/Windows-CI.md`、`liran_docs/modules/10-验证发布/macOS真机验收.md`、`liran_docs/modules/10-验证发布/Windows用户真机验收.md`、`.github/workflows/windows.yml`。

**适用范围**：所有开发、测试、部署、排障、真机验收、CI 状态更新和发布门禁判断。

## 不要用宽泛的运行时忽略规则遮蔽源代码目录

**现象**：仓库根目录的 `diagnostics/` 运行数据规则同时匹配了 `src/diagnostics/` 和 `tests/diagnostics/`，本机文件仍可参与编译和测试，但 Git 首次收集文件时会漏掉诊断实现和测试。

**根因**：`.gitignore` 中未以 `/` 限定根目录的目录模式，会匹配任意层级同名目录；本项目恰好有名为 `diagnostics` 的源码模块。

**正确做法**：运行数据规则使用 `/diagnostics/` 等根目录限定模式；修改忽略规则后，用 `git check-ignore --no-index --quiet` 检查源码和测试路径必须返回未忽略，并用 `git add --dry-run --all` 核对收集清单包含这些文件。

**验证方式**：回归测试 `tests/smoke/project-layout.test.ts` 检查 `src/diagnostics/redact.ts` 和 `tests/diagnostics/diagnostics.test.ts`；执行 `npm run build`、该 smoke 测试、`git check-ignore --no-index` 和 `git add --dry-run --all`。

**禁止事项**：不得仅因本机编译通过就认为首次提交或 CI 检出完整；不得用 `git add -f` 掩盖错误的忽略规则；不得把源码目录加入运行数据忽略范围。

**相关文件或命令**：`.gitignore`、`tests/smoke/project-layout.test.ts`、`src/diagnostics/`、`tests/diagnostics/`、`git check-ignore --no-index`、`git add --dry-run --all`。

**适用范围**：所有新增源码目录与同名运行数据目录、首次提交、CI checkout 和跨平台构建。

## 不要把不支持 audit 的 npm 镜像响应当成安全审计结果

**现象**：执行 `npm audit --audit-level=high` 时，配置的 `registry.npmmirror.com` 返回 `404 Not Found` 和 `NOT_IMPLEMENTED`，命令退出 1，但没有产生任何漏洞结论。

**根因**：当前 npm 镜像不实现 npm audit 使用的安全公告接口；这属于审计服务不可用，不代表存在漏洞，也不能当成零漏洞。

**正确做法**：保留本机 registry 配置不变，仅为本次审计命令显式指定 npm 官方 registry；必须根据第二次命令的真实退出码和漏洞统计记录结论。

**验证方式**：运行 `npm audit --registry=https://registry.npmjs.org --audit-level=high`，确认命令退出 0 并读取实际漏洞数量。

**禁止事项**：不得把镜像接口报错写成漏洞失败；不得在 audit 未得到结果时声称零漏洞；不得为了审计把 registry 凭据或私有源配置写入仓库。

**相关文件或命令**：`package-lock.json`、`npm audit --audit-level=high`、`npm audit --registry=https://registry.npmjs.org --audit-level=high`。

**适用范围**：使用第三方 npm registry 的本地验证、CI 安全审计和发布门禁。

## 不要在持久化完成后才开始捕获网页瞬时状态

**现象**：Windows Actions 首次运行中，59 项测试有 58 项通过；`T37 controlled browser fixture proves queued -> progressive images -> complete` 未观察到 `queued`，但同组生成、下载、10 张上限、部分成功和实时事件用例通过。

**根因**：提交确认后，流程先等待 `task.json` 持久化回调完成，再开始查找助手回复。Windows runner 的文件 I/O 足以跨过夹具仅短暂存在的 `queued` 状态，使首次采样直接读到 `generating`。

**正确做法**：在 `submit.click()` 前注册新助手回复观察 promise，使其覆盖点击事件本身；点击后与用户消息确认、提交记录持久化并行等待，缓存最早的 `data-state`，待提交记录和回复锚点都落盘后再发出状态事件。回归用例必须覆盖确认读取和持久化变慢的情况。

**验证方式**：`tests/integration/web-flow.test.ts` 在 `onSubmissionConfirmed` 中延迟 75ms；三次 Windows Actions 运行（`30532375079`、`30533952523`、`30534313119`）均暴露 `observed.includes("queued")`，最终修复把观察 promise 注册到 `submit.click()` 前，本机目标用例通过。随后运行完整 `npm run typecheck`、`npm test`、`npm run build`，并以新的 Windows Actions 运行结果作为跨平台收口证据。

**禁止事项**：不得通过删除 `queued` 断言、伪造排队事件或单纯放大固定等待时间掩盖竞态；不得在新的 Windows CI 变绿前把 T39 标记为通过。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`tests/integration/web-flow.test.ts`、`.github/workflows/windows.yml`、Windows Actions run `30532375079`。

**适用范围**：提交确认、回复绑定、状态监控、慢磁盘环境、Windows CI 和真实网页瞬时状态捕获。

## 跨平台路径测试不要硬编码 POSIX 绝对路径

**现象**：登录修复提交的 macOS 本地 64 项测试全部通过，但 Windows Actions run `30542014545` 在全量测试步骤退出 1，类型检查已通过。

**根因**：新增 Chrome 启动参数测试把预期 Profile 写死为 `/tmp/dedicated profile`；实现使用 Node `path.resolve`，Windows 会生成带盘符和反斜杠的原生绝对路径，字符串断言只在 POSIX 平台成立。

**正确做法**：测试输入和预期值都使用 Node `path.resolve`/`path.join` 生成当前平台路径，只断言业务约束，不把 macOS 路径表示当成跨平台合同。

**验证方式**：运行 `npm test`；修复提交 `d4b2fce` 的 Windows Actions run `30542680444` 已全步骤绿色。后续类似修复仍须等待对应最新提交的 `windows-latest` 结果。

**禁止事项**：不得在跨平台测试中写死 `/tmp`、盘符或路径分隔符；不得删除路径中空格的覆盖；不得用跳过 Windows 测试掩盖断言错误。

**相关文件或命令**：`tests/browser/session.test.ts`、`src/browser/profile.ts`、GitHub Actions run `30542014545` / job `90868799145`。

**适用范围**：macOS/Windows Profile、输出目录、CLI 参数和所有路径字符串断言。

## 递归文件结果与子进程启动预算必须使用当前平台语义

**现象**：Windows CI 的真实业务流程已成功，CLI 返回 0，但测试用 `${taskId}/task.json` 查找递归 `readdir` 结果时失败；同一 run 的跨进程 FIFO 夹具最初报 ready 文件启动超时，增加退出诊断后确认首个子进程以 code 1 提前退出。

**根因**：Windows 递归目录条目使用原生反斜杠，硬编码 POSIX `/` 无法匹配；测试还把 `D:\\...` 绝对路径直接写进 ESM `import`，Node ESM 要求 Windows 本地模块使用 `file:///D:/...` URL。原夹具忽略子进程 stderr，且 500ms 预算先掩盖了真实退出原因。

**正确做法**：使用 `path.join(taskId, "task.json")` 构造预期后缀；使用 `pathToFileURL(modulePath).href` 生成子进程 ESM import；跨进程夹具使用有界 5 秒 deadline，并在等待期间检查首个子进程是否已经退出，以区分慢启动与真实崩溃。业务锁、FIFO 顺序和生产超时不作放宽。

**验证方式**：本机定向运行 CLI 附件证据和双进程 FIFO 测试；推送后必须在最新提交对应的 Windows Actions 中确认完整 `npm test` 和 build 绿色，不能复用失败 run `32732163497` 或 `32733052229`。

**禁止事项**：不得把路径分隔符写死为 `/` 或 `\\`；不得无限等待或放宽生产队列超时；不得仅重跑失败 CI 而不修复可复现的跨平台假设。

**相关文件或命令**：`tests/integration/web-flow.test.ts`、`tests/tasks/profile-queue.test.ts`、`path.join`、`.github/workflows/windows.yml`。

**适用范围**：Windows/macOS/Linux 的递归文件枚举、独立 Node 进程夹具和跨进程队列验证。

## 不要让未锚定的 profiles 忽略规则排除源代码和测试

**现象**：本机依赖目录中存在 `src/profiles/` 和 `tests/profiles/`，所以 typecheck 和测试通过；提交后 Windows checkout 缺少 Profile 实现和测试，先后导致 typecheck 模块缺失、T57/T77 文件映射失败。

**根因**：`.gitignore` 使用未锚定的 `profiles/`，会匹配任意层级同名目录，而项目的运行数据目录才应该位于仓库根目录。

**正确做法**：运行数据规则写为 `/profiles/`；修改后检查 `git check-ignore --no-index`，并确认 `git ls-tree` 和 `git add --dry-run --all` 包含 `src/profiles/`、`tests/profiles/`。

**验证方式**：本机 `npm run typecheck`、`npm test` 通过；最新 Windows CI 必须在包含 Profile 源码和测试的 commit 上重新运行并检查完整结果。

**禁止事项**：不得因本机编译通过就认为 checkout 完整；不得使用 `git add -f` 掩盖忽略规则错误；不得把源代码或测试目录加入运行数据忽略范围。

**相关文件或命令**：`.gitignore`、`src/profiles/`、`tests/profiles/`、`git check-ignore --no-index`、`git ls-tree`、`npm test`。

**适用范围**：Profile 管理、跨平台 CI、首次提交和所有与运行数据同名的源码/测试目录。

## Windows 夹具必须给瞬时状态留出跨平台观察窗口

**现象**：Windows Actions run `30752880669` 只有 T37 夹具用例失败；断言要求观察到 `queued`，但其余生成、下载、10 张上限和安全用例均通过。本机同一用例通过。

**根因**：夹具原先只让助手回复保持 `queued` 30ms。Windows runner 的浏览器调度和提交确认耗时更长，第一次轮询已经读到 `generating`，导致瞬时状态断言不稳定；这不是生产网页或真实账号失败证据。

**正确做法**：对需要验证瞬时状态的夹具提供显式 `queueDelay` 参数，在 T37 用例中设置足够但有限的窗口（当前为 3000ms，测试超时 8000ms）；图片仍在窗口内完成，且保留 `queued -> generating -> image_ready -> complete` 的状态合同。不要删除排队断言或用固定 sleep 伪造事件。

**验证方式**：`tests/integration/web-flow.test.ts` 的 T37 目标用例和 `npm test` 在本机通过；修复后必须等待包含该修复的最新 Windows Actions 绿色结果，不能复用失败 run `30752880669`。

**禁止事项**：不得把偶发 Windows 夹具失败直接写成真实 ChatGPT 失败；不得只重跑而不判断根因；不得通过放宽业务状态机或删除逐状态断言掩盖竞态。

**相关文件或命令**：`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`、`.github/workflows/windows.yml`、Windows Actions run `30752880669`。

**适用范围**：跨平台浏览器夹具、排队/生成瞬态状态、Windows CI 和所有依赖时序的集成测试。

## queueDelay 必须覆盖图片创建定时器

**现象**：提交 `8f8d342` 的 Windows Actions run `30827418540` / job `91732507425` 只有 T37 排队/逐图夹具失败，122/123 测试通过；本机原测试可能通过但没有稳定证明排队窗口。

**根因**：夹具把 `queueDelay` 仅用于 `queued -> generating` 状态切换，图片仍按固定的 `80 * i` 毫秒创建；当队列窗口大于图片延时，首图会提前出现并把助手状态改为 `generating`，Windows 调度更容易让轮询错过 `queued`。

**正确做法**：图片创建时间使用 `queueDelay + 80 * i`，使排队窗口覆盖首图；回归测试在提交确认后等待 500ms 并断言尚无图片，同时继续断言 `queued`、`generating`、`image_ready` 和成功终态。不要改生产网页状态机来适配夹具。

**验证方式**：修复后本机 T37、`npm test` 123/123、`npm run test:integration` 12/12、`npm run typecheck`、`npm run build`、`npm audit --registry=https://registry.npmjs.org --audit-level=high` 和 `git diff --check -- .` 通过；Windows Actions run `30828797891` / job `91737204987` 已在修复提交上全步骤绿色。

**禁止事项**：不得删除 `queued` 断言、只增加无关固定 sleep、把本地夹具通过写成真实 ChatGPT 通过，或复用失败 run 作为新提交证据。

**相关文件或命令**：`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`、`.github/workflows/windows.yml`、Windows Actions run `30827418540`。

**适用范围**：所有依赖排队窗口、逐图出现和跨平台浏览器调度的夹具测试。

## CLI 版本输出不能维护独立硬编码值

**现象**：项目版本已从 `0.1.1` 递增到 `0.2.1`，但 `gpt-web-image --version` 仍输出 `0.1.1`，原测试也把旧值写死后继续通过。

**根因**：CLI 和测试各自维护一份版本字符串，没有以 `package.json` 为单一真源。

**正确做法**：CLI 从项目根 `package.json` 读取版本；版本测试同样读取 `package.json.version` 并与 CLI 输出全等比较。SemVer 变更时同步 package lock、CHANGELOG，并实际执行 `node dist/src/cli.js --version`。

**验证方式**：运行 `npm run build`、`node --test dist/tests/cli/cli.test.js` 和 `node dist/src/cli.js --version`，输出必须与 `package.json.version` 一致。

**禁止事项**：不得在 CLI、安装脚本或测试里维护彼此独立的版本常量；不得因旧测试绿色就认为版本元数据一致。

**相关文件或命令**：`package.json`、`package-lock.json`、`src/cli.ts`、`tests/cli/cli.test.ts`、`node dist/src/cli.js --version`。

**适用范围**：SemVer 递增、安装候选验证、CLI 诊断、Windows CI 和发布前门禁。

## resume 必须绑定已有助手回合而不是等待新回复

**现象**：`resume` 虽然能判断任务已经确认提交，但若只输出恢复决策而不重建网页观察器，任务会停在中间状态；若 observer 仍等待助手数量增加，又会错过崩溃前已经创建的助手回合。

**根因**：恢复需要同时复用任务绑定的 Profile、原会话 URL 和持久化的 `assistantTurnOrdinal`，不能把恢复误当成新提交。

**正确做法**：只有具备 `attemptId`、`confirmedAt`、`chatUrl` 和 `responseAnchor` 时才打开原会话；使用 `submit=false` 并直接绑定已存在的助手回合，继续下载、校验和逐图事件。证据不足时保持 `result_uncertain` 且不执行网页写操作。

**验证方式**：`tests/integration/web-flow.test.ts` 的 T34 恢复 observer 用例验证同一用户回合没有第二次提交且能交付剩余图片；`npm run typecheck`、`npm test` 和最新 Windows CI 必须通过。

**禁止事项**：不得在恢复时重新发送提示词、默认选择新助手回合、用固定延时代替回合锚点，或把受控夹具结果写成真实 ChatGPT 证据。

**相关文件或命令**：`src/cli.ts`、`src/chatgpt/web-flow.ts`、`src/persistence/recover.ts`、`tests/integration/web-flow.test.ts`。

**适用范围**：提交后中断恢复、登录接管后的继续观察、逐图下载和 JSONL 实时回显。

## 延迟 hydration 的资格夹具预算必须覆盖 Windows 并行负载

**现象**：提交 `40bf0b7` 的 Windows Actions run `30834139133` 在 T48 `manager eligibility waits for the hydrated composer before reading plan signals` 失败；页面在 150ms 后注入 composer，但 2 秒测试预算在 Windows 并行 Chrome fixture 负载下偶发耗尽。公开 job 页面要求登录，匿名日志 API 返回 403，原始逐行日志未读取。

**根因**：这是基于测试与公开失败标识的判断，信息不全，待人工补充原始日志；当前证据表明测试观察预算小于 Windows runner 的调度抖动，而不是生产会员识别逻辑变化。

**正确做法**：仅扩大 T48 测试的有界观察预算到 5 秒，继续等待稳定 composer 并保留登录/会员断言；生产默认 15 秒资格检查不因夹具失败而放宽。每次修复后必须在最新提交对应的 Windows Actions 中复验。

**验证方式**：运行 `npm run build && node --test dist/tests/manager/server.test.js`，确认 7/7；随后等待当前提交的 Windows CI 全量测试和 build 绿色。不得把旧 run `30833579612` 或失败 run `30834139133` 当作修复后的证据。

**禁止事项**：不得删除 hydration 等待或会员断言，不得用无限等待、跳过 T48 或修改生产资格门禁掩盖跨平台时序问题，不得把匿名 API 的 step 摘要写成完整日志。

**相关文件或命令**：`tests/manager/server.test.ts`、`src/manager/server.ts`、`src/browser/membership.ts`、`.github/workflows/windows.yml`、`npm run build`、`node --test dist/tests/manager/server.test.js`。

**适用范围**：管理页面登录/会员资格检查、延迟 composer hydration、Windows 并行 Chrome fixture 和所有跨平台定时测试。

## macOS Chrome 集成测试不要并行启动多个应用实例

**现象**：本机 macOS 并行运行全量测试时，唯一失败可能是 `T17 closes a dedicated Chrome before immediately reopening the same profile`；AppleScript 返回 `Google Chrome` 应用未运行（`-600`）。单独运行集成套件或串行运行全量测试通过。

**根因**：管理资格测试的 headless Chrome 和网页流程测试的正式 Chrome 共用 macOS 的 Google Chrome 应用身份。不同测试文件并行启动/关闭时，AppleScript 窗口定位可能落在应用生命周期切换的瞬间；这不是 ChatGPT 页面或真实账号失败证据。

**正确做法**：Node 测试脚本统一使用 `--test-concurrency=1`，让 macOS Chrome 生命周期测试串行执行；保留 AppleScript 有界重试和专用 Profile 隔离。生产任务仍由 BrowserLease 保证全局单受控 Chrome，不能通过放宽生产锁来迁就测试。

**验证方式**：`npm test` 和 `npm run test:integration` 必须在 macOS 真实 Chrome 上完整通过；复现时对比并行失败、`node --test --test-concurrency=1` 串行通过和单独集成套件通过。当前串行全量为 130/130。

**禁止事项**：不得把偶发 `-600` 直接写成真实 ChatGPT 失败；不得删除真实 Chrome 集成测试、忽略失败、无限重试或取消 BrowserLease/锁约束。

**相关文件或命令**：`package.json`、`src/browser/profile.ts`、`tests/integration/web-flow.test.ts`、`tests/manager/server.test.ts`、`node --test --test-concurrency=1`。

**适用范围**：macOS Chrome 真实/夹具集成测试、AppleScript 窗口控制、Profile 生命周期和跨平台内部门禁。
## 真机清单门禁必须绑定当前提交

**现象**：`liran_docs/09-真机实测.md` 可能保留多个历史 Windows Actions run；只看到旧 run 绿色，不能证明当前工作区提交已通过 CI。

**根因**：真机记录按时间追加，历史证据与当前提交状态容易混在一起；没有当前提交一致性检查时，文档会出现“证据看似完整但实际指向旧代码”的风险。

**正确做法**：每次收口在清单中记录当前完整提交、对应 Actions run/job 和最终状态；运行 `python3 scripts/check_real_test_checklist.py liran_docs/09-真机实测.md --require-complete`，确认必验行、范围豁免和当前提交证据均存在。提交后补充文档会产生新的 HEAD，因此清单记录的证据提交允许是当前 HEAD 或其祖先，但不能是无关提交。该脚本只做文档门禁，不能替代真实操作。

**验证方式**：先用一个旧或缺少当前 SHA 的清单运行严格模式，必须失败；补齐当前 SHA、成功 CI 和本轮范围记录后再运行，必须返回 0。

**禁止事项**：不得把历史 run、夹具结果、macOS 真机或 Windows CI 写成 Windows 用户真机通过；不得删除历史失败记录来让脚本通过。

**相关文件或命令**：`scripts/check_real_test_checklist.py`、`liran_docs/09-真机实测.md`、`.github/workflows/windows.yml`。

**适用范围**：所有跨平台 CI、macOS 真机和 Windows 用户验收收口。

## Windows Python 门禁输出必须显式使用 UTF-8

**现象**：清单内容本身完整，但 Windows Actions 的默认代码页无法打印中文错误，检查器在失败分支抛出 `UnicodeEncodeError`，导致测试失败且隐藏了原始门禁结果。

**根因**：Windows runner 的 `sys.stdout`/`sys.stderr` 可能使用非 UTF-8 编码；检查器错误信息包含中文，直接写入默认流会失败。

**正确做法**：文档门禁启动时对可用的标准输出和错误流调用 `reconfigure(encoding="utf-8", errors="replace")`；保留真实错误码和错误文本，不用修改文档内容或吞掉门禁失败。

**验证方式**：运行 `npm test` 中的清单检查器测试，并在 `windows-latest` 上确认失败样例能输出可读错误、完整样例返回 0；当前修复提交的 run `30947022763` 已验证。

**禁止事项**：不得依赖开发机 locale、把中文错误改成无意义的数字、捕获后返回成功，或把编码异常写成业务测试失败。

**相关文件或命令**：`scripts/check_real_test_checklist.py`、`tests/check-real-test-checklist.test.ts`、`.github/workflows/windows.yml`。

**适用范围**：Windows 文档门禁、Python CLI、JSON/文本诊断和所有包含中文输出的跨平台测试。

## 逐图取消夹具必须显式拉开图片间隔

**现象**：`T14 stops between image deliveries` 在 Windows runner 负载较高时偶发没有在第一张图后取消，表现为 `Missing expected rejection`；本机串行运行通常通过。

**根因**：夹具用固定 80ms 定时器产生连续图片；Windows 调度和第一张图片下载/校验耗时可能让多张图片在同一轮观察中同时出现，测试无法稳定证明“图间取消”。

**正确做法**：夹具支持 `imageGap` 参数，取消用例使用 500ms 间隔，确保第一张回调完成后第二张尚未产生；生产监控、取消语义和下载校验不作放宽。

**验证方式**：运行 `node --test --test-concurrency=1 dist/tests/integration/web-flow.test.js` 和完整 `npm test`；修复后的 Windows Actions run `30947022763` 全量 140/140 通过。

**禁止事项**：不得删除取消断言、改成只验证最终状态、无限增加生产超时或把一次偶发绿色 CI 当作稳定证据。

**相关文件或命令**：`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`、`npm run test:integration`。

**适用范围**：逐图回显、部分成功、取消/超时和 Windows/macOS Chrome 夹具时序测试。

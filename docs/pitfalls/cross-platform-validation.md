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

**正确做法**：对需要验证瞬时状态的夹具提供显式 `queueDelay` 参数，在 T37 用例中设置足够但有限的窗口（当前为 1000ms）；图片仍在窗口内完成，且保留 `queued -> generating -> image_ready -> complete` 的状态合同。不要删除排队断言或用固定 sleep 伪造事件。

**验证方式**：`tests/integration/web-flow.test.ts` 的 T37 目标用例和 `npm test` 在本机通过；修复后必须等待包含该修复的最新 Windows Actions 绿色结果，不能复用失败 run `30752880669`。

**禁止事项**：不得把偶发 Windows 夹具失败直接写成真实 ChatGPT 失败；不得只重跑而不判断根因；不得通过放宽业务状态机或删除逐状态断言掩盖竞态。

**相关文件或命令**：`tests/fixtures/chatgpt-page/index.html`、`tests/integration/web-flow.test.ts`、`.github/workflows/windows.yml`、Windows Actions run `30752880669`。

**适用范围**：跨平台浏览器夹具、排队/生成瞬态状态、Windows CI 和所有依赖时序的集成测试。

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

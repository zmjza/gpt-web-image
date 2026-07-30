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

**正确做法**：确认新用户消息后立即在浏览器侧启动新助手回复观察，并与提交确认持久化并行等待；缓存最早的 `data-state`，待提交记录和回复锚点都落盘后再发出状态事件。回归用例必须模拟较慢的提交确认回调。

**验证方式**：`tests/integration/web-flow.test.ts` 在 `onSubmissionConfirmed` 中延迟 75ms；修复前稳定失败于 `observed.includes("queued")`，修复后目标用例通过。随后运行完整 `npm run typecheck`、`npm test`、`npm run build`，并以新的 Windows Actions 运行结果作为跨平台收口证据。

**禁止事项**：不得通过删除 `queued` 断言、伪造排队事件或单纯放大固定等待时间掩盖竞态；不得在新的 Windows CI 变绿前把 T39 标记为通过。

**相关文件或命令**：`src/chatgpt/web-flow.ts`、`tests/integration/web-flow.test.ts`、`.github/workflows/windows.yml`、Windows Actions run `30532375079`。

**适用范围**：提交确认、回复绑定、状态监控、慢磁盘环境、Windows CI 和真实网页瞬时状态捕获。

# Windows CI

上级：[[_10-验证发布]]
下级：无
依赖：[[单元与契约测试]]、[[可控网页夹具]]、[[用户级安装与升级]]

---

## 场景

首版承诺 Windows x64，需要自动验证跨平台代码而不在 CI 使用真实账号。

## 触发

推送/PR 或发布候选验证。

## 逻辑

GitHub Actions `windows-latest` 安装受支持 Node、依赖与 Chrome，运行类型检查、单元/契约、夹具集成、安装、路径、锁、下载、清理和事件测试，并上传非敏感失败证据。

## 状态 / 边界

CI 不登录真实 ChatGPT，不证明网页真实流程完成。不得把模拟夹具通过写成 Windows 真机通过。

## 当前实测

2026-07-30 前三次运行 `30532375079`、`30533952523`、`30534313119` 暴露同一排队态竞态并已回写；提交 `8acd780` 的 run `30535884346` / job `90848962987` 曾全步骤成功。

当前 0.2.6 修复提交 `fe10c4e318a89150c994867c9435e1a22056689e` 对应 run `30828797891` / job `91737204987` 全步骤成功，覆盖 checkout、Node/依赖安装、Google Chrome 探测、typecheck、全量合同/安全/安装/浏览器夹具测试和 build。日志正文与 job/step 摘要均已读取，`npm test` 为 123/123，失败诊断上传步骤按条件跳过。该结果收口当前 T39、MP-7 和 IMG-6，但不等同 Windows x64 用户真机验收。

2026-08-04 的 0.2.7 修复提交 `5c4257baad14586384d260022f1b1bdfd82e57db` 对应 run `30833579612` / job `91753183805` 已 `completed/success`，覆盖 checkout、Node/依赖安装、Google Chrome 探测、typecheck、全量合同/安全/安装/浏览器夹具测试和 build；各 step 均成功，失败诊断上传按条件跳过。公开 GitHub job 页面提示“Sign in to view logs”，匿名日志 API 返回 403，因此本环境只能验证 run/job/step 摘要，不能声称已读取原始逐行日志。该结果继续不等同 Windows x64 用户真机验收。

## 2026-08-04 0.2.8 T48 失败与修复

- 失败 run `30834139133` / job `91755062305`（提交 `40bf0b7`）在全量测试 step 的 T48 延迟 hydration 资格检查失败。公开页面要求登录，匿名日志 API 返回 403；这里只记录可验证的失败 step/测试标识，不扩写未读取的原始日志。
- 判断根因：Windows 并行 Chrome fixture 负载下，页面 150ms hydration 后仅允许 2 秒的测试观察预算不稳定；生产资格检查仍为 15 秒。
- 修复：`tests/manager/server.test.ts` 仅把 T48 测试预算调整为 5 秒；本机 `npm run build && node --test dist/tests/manager/server.test.js` 为 7/7。包含修复的最新 run 必须重新验证，旧失败 run 不得复用。

## 2026-08-04 0.2.8 最新提交绿色证据

- 提交 `b8c4e5dcbf9bfd416662794a222e657f86532ead` 对应 run `30837899530` / job `91767462635`，状态 `completed/success`：<https://github.com/zmjza/gpt-web-image/actions/runs/30837899530>。
- 已通过 GitHub Actions 连接器读取完整 job 日志。环境为 Windows Server 2025、Node `v22.23.1`、npm `10.9.8`，checkout 工作目录为 `D:\a\gpt-web-image\gpt-web-image`；`npm ci` 显示 `found 0 vulnerabilities`，typecheck、全量 `npm test`（124/124，0 fail）和 build 均成功，Chrome 探测成功，失败诊断上传按条件跳过。
- 该 run 只证明 Windows CI/夹具和跨平台代码门禁，不证明真实 ChatGPT、macOS 真机或 Windows x64 用户验收；T42 仍未执行。

## 2026-08-04 当前候选复验

- 候选提交 `65881f64eb1c6b112d7f7d9036ed6bcdf2072c9e` 对应 run `30838217119` / job `91768543565`，状态 `completed/success`：<https://github.com/zmjza/gpt-web-image/actions/runs/30838217119>。
- 该候选未改变业务代码；本次运行重新验证 Windows Server 2025、Node `v22.23.1`、npm ci（0 vulnerabilities）、typecheck、124/124 测试和 build。它仍不等同 Windows x64 用户真机验收，T41 待用户反馈，T42 未执行。

## 2026-08-04 0.2.12 当前提交最终证据

- 提交 `2f506f3946fb43c4dfc8911ceb8059884e54553c` 对应 run `30890911224` / job `91932493250`，状态 `completed/success`：<https://github.com/zmjza/gpt-web-image/actions/runs/30890911224>。
- 已读取完整 job 日志：Windows Server 2025、Node `v22.23.1`、npm `10.9.8`，工作目录 `D:\a\gpt-web-image\gpt-web-image`；`npm ci` 报告 0 vulnerabilities，Chrome 探测、typecheck、全量 `npm test`（130/130，0 fail）和 build 均成功，失败诊断上传按条件跳过。
- 该 run 覆盖当前 Profile/图片管理、路径、迁移/备份、锁/进程、下载、JSONL、恢复和安全用例，但不包含真实 ChatGPT 登录，不等同 macOS 真机或 Windows x64 用户验收；T42 仍未执行。

## 2026-08-04 b2f2ecd 修复后最终 run

- 推送提交 `b2f2ecdc00221776dcb65493f300b1bd2a106331` 对应 run `30892675106` / job `91938185693`，状态 `completed/success`：<https://github.com/zmjza/gpt-web-image/actions/runs/30892675106>。
- 完整 job 日志已读取，Windows Server 2025、Node `v22.23.1`、npm `10.9.8`；`npm ci` 0 vulnerabilities，Chrome 探测、typecheck、全量 `npm test`（130/130）和 build 均成功。
- 这是当前提交的最终跨平台门禁证据，不证明真实 ChatGPT、macOS 真机或 Windows x64 用户验收；T42 仍未执行。

## 2026-08-04 43321b5 文档提交最终 run

- 提交 `43321b571e6c6057331ab51f543a855d34a81ea6` 对应 Windows CI run `30894814644` / job `91945099220`，状态 `completed/success`：<https://github.com/zmjza/gpt-web-image/actions/runs/30894814644>。
- 完整 job 日志已读取，Windows Server 2025、Node `v22.23.1`、npm `10.9.8`；`npm ci` 0 vulnerabilities，Chrome 探测、typecheck、全量 `npm test`（130/130）和 build 均成功。
- 该 run 只证明当前提交的跨平台代码与夹具门禁，不证明真实 ChatGPT、macOS 真机或 Windows x64 用户验收；T42 仍未执行。

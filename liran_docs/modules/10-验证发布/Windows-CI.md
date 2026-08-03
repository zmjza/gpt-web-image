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

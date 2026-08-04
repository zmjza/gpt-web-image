# API 与协议文档

> CLI 与协议已完成内部实现并通过本地单元、契约和可控 Chrome 夹具测试。真实 ChatGPT、Windows CI 与双平台真机结果仍以 [[09-真机实测]] 为准。

## Skill 输入契约

- **隐式触发**：当请求明确要求生成、画、创建、改图或继续修改图片。
- **显式触发**：`$gpt-web-image {自然语言要求}`。
- **输入来源**：自然语言、Codex 附件、本地绝对路径、前序 taskId/resultId。
- **规范化输出**：[[06-数据字典]] 中的 `NormalizedRequest`。
- **歧义返回**：一个最小问题与候选列表；不创建 CLI 提交。

## CLI

构建后入口为 `node dist/src/cli.js`，npm bin 名称为 `gpt-web-image`。

| 命令 | 主要输入 | 用途 | 是否可产生网页提交 |
|---|---|---|---|
| `setup` | 可选 Chrome/Profile 配置 | 可视登录并验证会话 | 否 |
| `doctor` | `--json` 可选 | 检查 Node、Chrome、目录、锁和 Profile；输出 `profile.path`、`profile.markerPath`、`profile.retentionPolicy` | 否 |
| `generate` | prompt、count、ratio、references | 创建新对话并文字/参考图生图 | 是 |
| `edit` | prompt、references、count | 新对话中改图 | 是 |
| `refine` | taskId、resultIds、prompt | 原会话连续修改 | 是 |
| `resume` | taskId | 只读核对后恢复非终态任务 | 仅明确证明未提交时才可能提交 |
| `cancel` | taskId | 取消排队或执行任务 | 否 |
| `cleanup` | `--dry-run` / `--json` | 清理过期诊断资料 | 否 |
| `install` | 用户级目标目录 | 安装/升级 Skill | 否 |

### 通用 CLI 规则

- stdout 仅输出 JSONL ProgressEvent；人工日志写 stderr。
- 所有路径参数在使用前规范化并验证。
- 破坏性操作仅限 cleanup 对 diagnostics 根内已过期文件，支持 dry-run。
- 专用 Chrome Profile 默认位于 macOS `~/Library/Application Support/gpt-web-image/chrome-profile`、Windows `%LOCALAPPDATA%\\gpt-web-image\\chrome-profile`；Profile 元数据标记为 `.gpt-web-image-profile.json`。自动命令永不删除或重建 Profile，cleanup 触碰 Profile 路径时拒绝执行。
- 任何网页提交前必须完成 task.json 原子写入和 attemptId 建立。

## JSONL 事件协议 v1

每行一个完整 JSON 对象，不允许前后附加普通文本。

| type | 触发 | image 字段 | Codex 行为 |
|---|---|---|---|
| `state` | TaskState 改变 | null | 转述关键状态 |
| `progress` | 数量或补图轮次改变 | null | 显示 `X/N`，相同值节流 |
| `image_ready` | 唯一 ImageResult 校验成功 | 必填 | 立即按绝对路径渲染 |
| `warning` | 可恢复异常/人工验证 | 可选 | 明确告警与下一状态 |
| `terminal` | 进入终态 | 可选 | 核对并输出最终摘要 |

`image_ready.image` 至少包含 `resultId`、`originalPath`、`previewPath`、`mimeType`、`width`、`height`、`byteLength` 和 `sha256`。Codex 优先显示 previewPath，否则显示 originalPath；显示后不得等待整批完成才输出。

## task.json 契约 v1

- 写入位置：`{taskOutputDir}/task.json`。
- 写入方式：同目录临时文件 + 原子替换。
- 数据结构：[[06-数据字典]] `TaskRecord`。
- 安全：禁止密码、Cookie、Authorization、令牌、完整请求头和完整页面 HTML。
- 兼容：遇到未知 schemaVersion 必须停止恢复并提示升级，不得按旧结构猜测。

## 恢复契约

1. 加载并验证 task.json、任务目录与已存在 ImageResult。
2. 读取提交确认、chatUrl 和 responseAnchor 证据。
3. 获取 Profile 锁并打开原会话；不得先发送任何消息。
4. 能唯一证明任务归属时重建观察器并继续未完成下载/监控。
5. 无法证明是否提交或无法绑定回复时进入 `result_uncertain`。
6. 只有明确证明此前没有提交时，才允许在用户原请求范围内重新提交。

## 规划退出码

| 退出码 | 名称 | 含义 | 可恢复 |
|---|---|---|---|
| 0 | `OK` | 成功或命令完成 | 否 |
| 10 | `PARTIAL_SUCCESS` | 有合格图片但未达目标 | 视原因 |
| 20 | `INVALID_INPUT` | 输入/配置无效 | 否，需修正 |
| 21 | `AMBIGUOUS_INPUT` | 需要用户选择 | 否，需补充 |
| 30 | `LOGIN_REQUIRED` | 需要首次登录 | 是 |
| 31 | `HUMAN_VERIFICATION_REQUIRED` | 需要验证码/安全验证 | 是 |
| 32 | `PROFILE_LOCKED` | 专用 Profile 被活实例占用 | 是 |
| 40 | `PAGE_STRUCTURE_CHANGED` | 网页结构不满足不变量 | 修复适配器后 |
| 41 | `SUBMISSION_UNCERTAIN` | 无法判断是否已提交 | 人工/恢复核对 |
| 42 | `TASK_TIMED_OUT` | 无活动或硬超时 | 视 task.json |
| 43 | `TASK_CANCELLED` | 用户取消 | 否 |
| 50 | `DOWNLOAD_FAILED` | 网页结果存在但原图下载失败 | 可有限重试 |
| 51 | `VALIDATION_FAILED` | 下载文件不是合格图片 | 可有限重试 |
| 60 | `PERSISTENCE_FAILED` | task.json/文件写入失败 | 修复存储后 |
| 70 | `INTERNAL_ERROR` | 未分类内部错误 | 依诊断判断 |

## 错误事件要求

- `message` 必须是简洁、脱敏、可操作的中文。
- `recoverable` 必须由明确分类给出，不能一律 true。
- 网页生成成功但下载失败必须使用下载类错误，不能发 `succeeded`。
- 内容政策拒绝记录为明确失败，不自动改写规避。

## Profile 管理服务 API（规划）

本节只定义本轮规划契约，当前仓库尚未实现管理服务；所有接口必须绑定本机 `127.0.0.1`，不得提供云端或局域网入口。

| 方法 | 路径 | 责任 | 主要错误 |
|---|---|---|---|
| GET | `/profiles` | 读取注册表并扫描默认根目录后返回列表 | `REGISTRY_INVALID`、`SCAN_FAILED` |
| POST | `/profiles` | 创建新 Profile 目录、归属标记和注册记录 | `PATH_INVALID`、`PROFILE_EXISTS` |
| POST | `/profiles/import` | 用户显式导入已有专用 Profile | `NOT_OWNED`、`DAILY_PROFILE_REJECTED` |
| PATCH | `/profiles/:id` | 修改名称、备注和说明 | `PROFILE_NOT_FOUND` |
| DELETE | `/profiles/:id` | 二次确认后删除目录和注册记录 | `ACTIVE_PROFILE`、`PROFILE_BUSY`、`DELETE_CONFIRMATION_REQUIRED` |
| POST | `/profiles/:id/activate` | 检查登录/会员/占用后设为唯一启用项 | `LOGIN_REQUIRED`、`MEMBERSHIP_NOT_ELIGIBLE`、`PROFILE_BUSY` |
| POST | `/profiles/:id/check` | 检查归属、登录、会员和可写状态 | `CHECK_FAILED` |
| POST | `/profiles/:id/open` | 启动或复用唯一专用 Chrome | `BROWSER_BUSY`、`CHROME_UNAVAILABLE` |
| POST | `/profiles/:id/close` | 只关闭项目记录的专用 Chrome | `NOT_PROJECT_BROWSER`、`BROWSER_CLOSE_FAILED` |
| GET | `/directories` | 返回默认根目录、历史根目录和扫描摘要 | `PATH_INVALID` |
| POST | `/directories/plan` | 生成迁移/保留/取消预检计划 | `DIRECTORY_CONFLICT`、`PROFILE_BUSY` |
| POST | `/directories/migrate` | 执行已确认的复制、校验、切换和源清理 | `MIGRATION_FAILED`、`MIGRATION_CONFLICT` |
| POST | `/directories/retain` | 只更新默认创建根目录并登记历史根目录 | `PATH_INVALID` |
| POST | `/profiles/:id/backups` | 浏览器关闭后创建包含 Chrome 登录数据的未加密备份 | `PROFILE_BUSY`、`BACKUP_FAILED` |
| POST | `/backups/:id/restore` | 从本地备份恢复为新 Profile | `BACKUP_INVALID`、`RESTORE_FAILED` |

### API 边界

- DELETE 必须收到页面二次确认产生的短期确认值；自动命令不能构造该值。
- API 响应只返回路径、状态、时间和用户备注，不返回邮箱、Cookie、Token、密码或页面原文。
- 迁移响应必须包含源/目标、Profile 数量、冲突和是否需要关闭浏览器；冲突非空时不得执行。
- 会员检查必须返回 `plus/pro/go/other/technical_failure`，不能把 `unknown` 当作可启用状态。
- 所有写操作使用临时文件和原子替换；失败时保留旧注册表。
# 图片管理本地 API

> 本节契约已在 `src/manager/server.ts` 实现。服务只监听 `127.0.0.1`，响应脱敏并保留 Profile 归属。

| 方法 | 路径 | 目的 | 状态 |
|---|---|---|---|
| GET | `/profiles` | 返回可选择 Profile 的非敏感摘要 | 已实现 |
| GET | `/profiles/:profileId/images` | 返回单 Profile 图片列表，支持 filter/sort/group/page | 已实现 |
| GET | `/profiles/:profileId/images/:imageId` | 返回图片或任务状态详情与可用操作 | 已实现 |
| GET | `/profiles/:profileId/images/:imageId/content` | 返回原图/缩略图或导出下载 | 已实现 |
| POST | `/profiles/:profileId/images/:imageId/open-directory` | 用系统文件管理器打开受控所在目录 | 已实现 |
| POST | `/profiles/:profileId/images/scan` | 首次或手动重新扫描 | 已实现 |
| GET | `/profiles/:profileId/images/index-status` | 返回扫描时间和错误摘要 | 已实现 |

## 请求约束

- `profileId` 必须来自注册表；服务端重新解析根目录，不信任客户端路径。
- 筛选支持时间、项目/任务、生成类型、格式、尺寸/方向、状态和关键词组合。
- 默认排序为 `generatedAt_desc`，默认单 Profile，不允许全局跨 Profile 查询。

## 错误契约

已实现错误码包括 `PROFILE_NOT_FOUND`、`PROFILE_SCOPE_VIOLATION`、`DIRECTORY_MISSING`、`PERMISSION_DENIED`、`SCAN_FAILED`、`INDEX_READ_FAILED`、`INDEX_INVALID`、`IMAGE_NOT_FOUND`、`IMAGE_MISSING`、`IMAGE_CORRUPT`、`IMAGE_UNAVAILABLE` 和 `INVALID_INPUT`。非数字、越界分页、反向尺寸范围和无效时间均返回 400；错误响应不包含认证数据、完整敏感日志或未脱敏 URL。

## 2026-08-05 Profile 管理生命周期修复收口

以下行为已在 `src/manager/server.ts` 和管理页面中实现，并由隔离页面 E2E、管理服务回归和 macOS 真实只读检测覆盖：

| 操作 | 实际语义 | 关键约束 |
|---|---|---|
| `GET /profiles` | 扫描默认根目录后返回 Profile 摘要 | 每项增加 `pathStatus`；只返回路径、状态、时间和备注，不返回认证数据 |
| `POST /profiles/:id/check` | 受控后台 Chrome 检测登录、会员和 Chrome 状态 | 不改变 active；不把检测会话标记为手动打开；失败保留原 active |
| `POST /profiles/:id/activate` | 先做资格检查，再启用该 Profile | 只允许 `logged_in` 且 `plus/pro/go`；切换前关闭旧项目浏览器；全局最多一个 active |
| `POST /profiles/:id/open` | 打开或复用该 Profile 的项目专用 Chrome | 不等同启用；只允许 `pathStatus=ok`，使用全局 BrowserLease |
| `POST /profiles/:id/close` | 关闭该 Profile 的项目专用 Chrome | `closed` 幂等；关闭中显示 `closing`；只关闭项目拥有的进程，异常回写 `unknown` 并释放 lease/锁 |

### Profile 路径状态

`pathStatus` 只允许 `ok`、`missing`、`mismatch`、`not_owned`、`unreadable`。检测、启用、打开和关闭在状态不是 `ok` 时返回 `PROFILE_PATH_INVALID`（HTTP 422），防止把错误路径显示成可用 Profile。创建和导入提交时再次校验归属标记，扫描提交事务内按规范化路径和名称去重。

### 管理页面错误映射

`BROWSER_LEASED`、`NOT_PROJECT_BROWSER`、`PROFILE_BUSY` 等资源冲突返回 HTTP 409；`MEMBERSHIP_INELIGIBLE`、`PROFILE_PATH_INVALID` 等资格或路径问题返回 HTTP 422；未知错误保持脱敏的 `INTERNAL_ERROR`，不回显请求值或浏览器认证信息。

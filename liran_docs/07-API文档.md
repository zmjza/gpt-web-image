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
| `doctor` | `--json` 可选 | 检查 Node、Chrome、目录、锁和 Profile | 否 |
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

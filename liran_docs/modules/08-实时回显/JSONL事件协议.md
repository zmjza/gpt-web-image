# JSONL 事件协议

上级：[[_08-实时回显]]
下级：无
依赖：[[TaskRecord与任务ID]]、[[状态机与迁移]]

---

## 场景

长任务需要让 Codex 在控制脚本尚未退出时持续获得可靠、可恢复的进度。

## 触发

任务状态变化、图片成功、可恢复告警或终态产生。

## 逻辑

stdout 每行只输出一个版本化 JSON 对象，至少含 schemaVersion、taskId、seq、timestamp、type、state、message、completed、target、recoverable 和可选 image。seq 单调递增并持久化。

## 状态 / 边界

机器事件不能混入非 JSON 日志；诊断写 stderr 或文件。事件不得包含认证信息。未知事件版本必须被宿主明确拒绝或降级为文本告警。

## 当前实现

已创建 `src/events/schema.ts` 与 `src/events/writer.ts`，实现 v1 事件字段、类型/状态校验、单行 JSON 输出、单调递增序号和敏感消息拒绝；本地契约测试已通过。事件持久化和图片下载回显属于后续任务。

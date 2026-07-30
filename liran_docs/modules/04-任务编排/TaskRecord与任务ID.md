# TaskRecord 与任务 ID

上级：[[_04-任务编排]]
下级：无
依赖：[[配置加载与默认值]]、[[task-json持久化]]

---

## 场景

每次生成、改图、连续修改和恢复都需要稳定身份与可审计状态。

## 触发

输入解析完成且无歧义后创建任务，或 resume 加载已有任务。

## 逻辑

生成跨平台安全的唯一 taskId，初始化 schemaVersion、类型、提示词、目标数量、引用、会话、状态、结果、补图和时间字段，并原子持久化。

## 状态 / 边界

taskId 不能包含路径特殊字符。恢复不得修改原 taskId；凭据、Cookie 和认证头不属于 TaskRecord。

## 当前实现

已创建 `src/tasks/id.ts` 与 `src/tasks/model.ts`，实现路径安全 taskId、TaskState 白名单和 TaskRecord 初始工厂；本地契约测试已通过。task.json 原子持久化属于 T10，当前尚未实现。

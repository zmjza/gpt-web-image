# Profile 注册表与生命周期

上级：[[_11-多Profile管理]]
依赖：[[配置加载与默认值]]、[[Profile生命周期]]

## 目标

以版本化、原子写入的 `profile-registry.json` 管理 Profile 元数据、默认根目录、历史保留目录和唯一 `activeProfileId`。Chrome 认证内容不复制到注册表。

## 规则

- 兼容现有 `chrome-profile`，首次读取时原地注册。
- `ProfileRecord.profileDir` 必须是规范化绝对路径，归属标记必须匹配。
- 注册表损坏时拒绝写入和启用，不能猜测恢复。
- 只有页面确认删除流程能触发物理删除；自动命令不得调用删除实现。

## 任务

关联：T43、T59。验证：T-MP-01、T-MP-09、T-MP-14。

# 图片管理 API 与 UI 接入

## API 规划

只规划本地回环服务契约，不伪造已存在接口：Profile 列表、选择上下文、图片扫描、图片列表、筛选排序、详情、重新扫描和明确错误响应。所有响应都必须脱敏并带 `profileId` 归属。

## UI 接入门禁

用户提供 Stitch Project/Screen 或真实 HTML/CSS/资源后，先记录事实来源和文件映射，完成控件规格盘点；随后只在现有 `src/manager/public/` 壳中新增图片管理导航和页面状态。初次接收只能得到“可以进入实例级细节复修”或“初次承接受阻”；实例级细节复修通过后，才能接真实 API、状态、事件、类型和权限入口。

## 当前禁止

- 本阶段不得修改现有 UI 源码或新增业务接口实现。
- 不得创建独立 prototype.html，不得替换全局样式，不得接入真实 Profile 文件操作。

## 规划文件

`src/manager/image-api.ts`、`src/manager/public/`、`liran_docs/10-UI壳接入清单.md`、`liran_docs/ui-shells/Profile管理控制台-UI壳接入清单.md`。

# Stitch 原始产物

- Project：`GPT Profile Manager`
- Project ID：`18230660193198829480`
- Screen：`GPT Web Image - 导航易读性优化版`
- Screen ID：`06f8eaec0ace43eb91960233146f13c9`
- 设备：Desktop
- 原始画布：2560×2048
- 来源：Stitch MCP `get_screen`

## 文件

- `source.html`：Stitch 下载的原始 HTML，作为第一视觉事实来源，不直接改写。
- `screenshot.png`：Stitch 下载的截图预览。
- `assets/background.jpg`：首次按页面引用下载的原始文件名，服务端实际返回 PNG 内容。
- `assets/background.png`：按真实 MIME 内容保存的本地副本，用于真实前端 UI 壳。

## 说明

当前 Screen 内部通过 JavaScript 切换四个逻辑视图：Profile 总览、默认目录与迁移、安全与备份、Profile 详情；另有创建/导入 Profile 弹窗。真实业务 API、Profile 文件操作和浏览器控制不属于 Stitch UI 壳阶段。

# 项目协作规则

## 长期避坑知识库

- 任何 Codex/AI 开发、修复、测试、部署或排障前，必须先读取本文件。
- 开始具体工作前，必须读取 [`docs/pitfalls/README.md`](docs/pitfalls/README.md) 和与当前模块相关的避坑文件。
- 任务收尾前必须检查本次是否发现新坑；确认后将新坑追加到 `docs/pitfalls/` 的合适文件。任务中断时，也应尽量记录已经发现但尚未提炼的坑。
- 避坑知识库不得写入密钥、Token、账号密码、隐私数据、生产配置全文或完整敏感日志。
- 本文件只保存规则和索引；具体现象、根因、正确做法和验证证据必须写入 `docs/pitfalls/`。

## 索引

- [`docs/pitfalls/README.md`](docs/pitfalls/README.md)：知识库用途、读取/写入流程、条目格式和文件索引。
- [`docs/pitfalls/browser-session.md`](docs/pitfalls/browser-session.md)：专用 Chrome Profile、首次可视登录和人工接管边界。
- [`docs/pitfalls/image-delivery.md`](docs/pitfalls/image-delivery.md)：网页图片绑定、原图校验、`image_ready` 和实时回显边界。
- [`docs/pitfalls/cross-platform-validation.md`](docs/pitfalls/cross-platform-validation.md)：本地夹具、Windows CI、macOS 真机和 Windows 用户验收的证据边界。

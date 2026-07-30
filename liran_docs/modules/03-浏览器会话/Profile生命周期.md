# Profile 生命周期

上级：[[_03-浏览器会话]]
下级：无
依赖：[[系统目录与路径规范]]、[[单实例锁与残留进程]]

---

## 场景

首次登录和后续任务都需要复用独立 Chrome 用户数据，同时与日常 Chrome 隔离。

## 触发

setup、generate、edit、resume 或 doctor 启动浏览器上下文。

## 逻辑

解析专用 Profile 根目录，获取锁，检查归属标记。macOS 默认位置为 `/Users/<用户>/Library/Application Support/gpt-web-image/chrome-profile`，Windows 默认位置为 `%LOCALAPPDATA%\\gpt-web-image\\chrome-profile`。Profile 根目录内的 `.gpt-web-image-profile.json` 记录规范化路径和 `retentionPolicy=never-auto-delete`。可视模式使用正式 Chrome 进程、专用 `user-data-dir` 和非零回环调试端口，再通过 CDP 连接监测；后台模式使用同一持久化 Profile。正常关闭只释放浏览器进程和临时锁，不删除 Profile 数据。

## 状态 / 边界

Profile 不得进入 Git 或任务输出目录。任何自动命令都不得删除或重建 Profile；只有用户明确提出并确认后，才可讨论人工清理方案。异常终止时只清理由本项目记录的进程和 `.gpt-web-image.lock`；不能连接、修改或结束用户日常 Chrome Profile。

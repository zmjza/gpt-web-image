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

解析专用 Profile 根目录，获取锁，检查归属标记。可视模式使用正式 Chrome 进程、专用 `user-data-dir` 和非零回环调试端口，再通过 CDP 连接监测；后台模式使用带沙箱的 Playwright 持久化上下文。正常关闭后再释放锁。

## 状态 / 边界

Profile 不得进入 Git 或任务输出目录。异常终止时只清理由本项目记录的进程；不能连接、修改或结束用户日常 Chrome Profile。

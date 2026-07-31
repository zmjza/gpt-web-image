# Windows 用户真机验收

上级：[[_10-验证发布]]
下级：无
依赖：[[Windows-CI]]、[[09-真机实测]]

---

## 场景

Windows CI 无法证明真实 ChatGPT 登录、生图和 Codex 宿主回显。

## 触发

Windows CI 通过且发布候选安装包/Skill 准备完毕。

## 逻辑

当前不创建安装包或 Release；向用户提供固定 Git 提交源码候选和 PowerShell 最短步骤（`npm ci`、`npm run build`、`npm run install:user`、`doctor`、`setup`），再验证首次登录、最小化后台 1 张/多张、逐张回显、文件路径和一次改图；用户反馈失败时记录证据、回写、修复并重新验收。

## 状态 / 边界

用户明确通过前保持 `待用户验收`，不能标记 Windows 真机或双平台完成。Codex 不伪造用户反馈或远程操作不存在的 Windows 设备。验收不得提交密码、Cookie、Token、验证码或完整敏感日志；专用 Profile 默认位于 `%LOCALAPPDATA%\\gpt-web-image\\chrome-profile`，不得删除或替换个人 Chrome Profile。

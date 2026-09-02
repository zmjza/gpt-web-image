# Disable Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让生图流程完全跳过 ChatGPT 模型菜单，直接使用当前模型提交。

**Architecture:** 仅从共享的 `runWebImageFlow` 提交入口移除模型选择依赖，使 generate/edit/refine 同时生效。保留持久化旧字段读取兼容，不引入配置开关。

**Tech Stack:** TypeScript, Node.js test runner, Playwright 受控页面夹具。

---

### Task 1: 回归测试

**Files:**
- Modify: `tests/integration/web-flow.test.ts`
- Modify: `tests/skill/metadata.test.ts`

- [ ] 将旧模型选择集成用例收敛为一个用例：模型项全部不可用时仍能生成，菜单不打开。
- [ ] 修改 Skill 元数据断言，要求明确说明不读取、打开或切换模型菜单。
- [ ] 运行定向测试，确认生产代码和 Skill 均先失败。

### Task 2: 最小实现

**Files:**
- Modify: `src/chatgpt/web-flow.ts`
- Modify: `src/cli.ts`
- Modify: `.agents/skills/gpt-web-image/SKILL.md`

- [ ] 删除 `runWebImageFlow` 的模型选择导入、回调、调用和返回证据。
- [ ] 删除 CLI 写入新模型选择证据的回调。
- [ ] 更新 Skill 执行约定，直接使用 ChatGPT 当前模型。
- [ ] 运行定向测试，确认通过。

### Task 3: 版本、文档与交付

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `liran_docs/01-需求文档.md`
- Modify: `liran_docs/04-开发追踪.md`
- Modify: `liran_docs/06-数据字典.md`
- Modify: `docs/pitfalls/browser-session.md`

- [ ] 将版本升级为 `0.5.0`，记录行为变更和兼容边界。
- [ ] 更新需求、追踪、数据字典和避坑条目。
- [ ] 运行 typecheck、完整测试、build、Skill 校验、diff 检查和 audit。
- [ ] 同步用户级 Skill，创建 Conventional Commit，并只在已配置的远程/发布能力上执行交付；缺失的 Gitee 或统一发布命令必须如实报告。

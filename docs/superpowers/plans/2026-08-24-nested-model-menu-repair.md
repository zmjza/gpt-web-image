# Nested Model Menu Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `gpt-web-image` safely select and verify an image-capable model through ChatGPT's nested Radix model menu, then publish version 0.4.0 after real image-to-image verification.

**Architecture:** Keep model selection isolated in `src/chatgpt/model-selection.ts`. Treat mixed-label and submenu nodes as navigation containers, open them with keyboard interaction, then verify only leaf options or the capability slider. Extend the controlled browser fixture to reproduce the live DOM structure before changing production behavior.

**Tech Stack:** TypeScript, Node test runner, Playwright Core, controlled HTML fixture, npm scripts.

---

### Task 1: Add the failing nested-menu regression

**Files:**
- Modify: `tests/chatgpt/model-selection.test.ts`
- Modify: `tests/fixtures/chatgpt-page/index.html`
- Modify: `tests/integration/web-flow.test.ts`

- [ ] **Step 1: Add a mixed-container classification assertion**

```ts
assert.equal(classifyModelLabel("GPT-5.6 Sol 高 GPT-5.6 Sol 中 极速"), null);
```

- [ ] **Step 2: Add a `nested-capability` fixture mode**

The fixture exposes a visible `role="menuitem"` with `data-has-submenu`, `aria-haspopup="menu"`, and mixed descendant model labels. Pointer clicks are intercepted by an overlay; `Enter` opens the capability group and slider.

- [ ] **Step 3: Add an integration assertion**

```ts
const result = await runWebImageFlow({
  page,
  prompt: "嵌套模型菜单",
  targetCount: 1,
  outputLayout,
  stabilityWindowMs: 10,
  pollIntervalMs: 10,
  timeoutMs: 3000
});
assert.equal(result.modelSelection?.modelKey, "gpt-5.6-sol-high");
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run: `npm run build && node --test dist/tests/chatgpt/model-selection.test.js dist/tests/integration/web-flow.test.js --test-name-pattern='mixed|nested model'`

Expected: FAIL because the mixed parent is classified as a concrete model or because pointer activation cannot open the submenu.

### Task 2: Implement leaf-only classification and keyboard submenu navigation

**Files:**
- Modify: `src/chatgpt/model-selection.ts`

- [ ] **Step 1: Make label classification reject multiple model meanings**

Collect all matched model keys and return a model only when the set size is exactly one.

- [ ] **Step 2: Exclude navigation containers from leaf options**

Record `hasSubmenu` from `aria-haspopup`, `data-has-submenu`, and `aria-expanded`; do not return those controls from `readVisibleModelControls`.

- [ ] **Step 3: Open the capability submenu through its accessible keyboard contract**

Find one visible, enabled submenu entry associated with model/capability text, call `focus()` and `press("Enter")`, and rescan the capability group. Multiple candidates remain an uncertainty error.

- [ ] **Step 4: Activate final leaf options with the keyboard**

Use `focus()` and `press("Enter")`; keep existing selected-attribute and trigger-state verification.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm run build && node --test dist/tests/chatgpt/model-selection.test.js dist/tests/integration/web-flow.test.js --test-name-pattern='mixed|nested model'`

Expected: PASS.

### Task 3: Preserve skill routing and document the pitfall

**Files:**
- Modify: `.agents/skills/gpt-web-image/SKILL.md`
- Modify: `docs/pitfalls/browser-session.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Merge the global routing boundary into the repository skill**

Preserve implicit image-generation routing and explicit delegation to `liran-image2`, `image2`, or `gpt-image-2`.

- [ ] **Step 2: Add the nested-menu operational invariant**

Document that submenu containers cannot be treated as model options and pointer interception must not be bypassed with an unverified force click.

- [ ] **Step 3: Validate the source skill**

Run: `python3 /Users/liran/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/gpt-web-image`

Expected: validation succeeds.

### Task 4: Verify locally and on the real ChatGPT flow

**Files:**
- Modify after evidence: `liran_docs/09-真机实测.md`

- [ ] **Step 1: Run local gates**

Run: `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, `npm audit --registry=https://registry.npmjs.org --audit-level=high`, and `git diff --check -- .`.

- [ ] **Step 2: Run the real image-to-image request**

Use `node dist/src/cli.js edit --reference /var/folders/32/_qr470ss5b18sz4jpvrpy7j00000gn/T/codex-clipboard-98899e6b-2a34-440a-a790-ea47c14fb084.png --prompt <pixel-avatar-prompt> --count 1 --ratio 1:1`.

Expected: one `image_ready`, model selection evidence, confirmed reference attachment, and terminal success.

- [ ] **Step 3: Inspect the image and persisted task evidence**

Confirm the delivered file is the current task's unique original download, can be decoded, and matches the requested square direction. Record actual dimensions without claiming native 4K if ChatGPT did not return it.

### Task 5: Bump, install, commit, push, and release

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `liran_docs/09-真机实测.md`

- [ ] **Step 1: Bump the approved version**

Run: `npm version 0.4.0 --no-git-tag-version`.

- [ ] **Step 2: Re-run all release gates**

Repeat typecheck, full tests, integration tests, build, audit, skill validation, real-evidence inspection, and full diff review against the release candidate.

- [ ] **Step 3: Install and validate the user skill**

Run: `npm run install:user`, then validate `/Users/liran/.codex/skills/gpt-web-image` and compare its `SKILL.md` with the repository source.

- [ ] **Step 4: Commit and push**

Create an atomic Conventional Commit for version `0.4.0`, push the current branch to each configured required remote, and verify remote commit hashes.

- [ ] **Step 5: Publish only through the project release command**

Run `npm run release:publish -- --notes <0.4.0 notes>` only if that command and required release assets exist. Verify tag, release notes, status, and every required asset. If the repository lacks the required command or remote, report the exact blocker and do not claim complete release.

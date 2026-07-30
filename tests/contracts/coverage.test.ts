import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const IMPLEMENTED_FILES = [
  "src/persistence/task-store.ts", "src/diagnostics/redact.ts", "src/diagnostics/cleanup.ts", "src/browser/profile-lock.ts",
  "src/tasks/queue.ts", "src/tasks/count-policy.ts", "src/tasks/selection.ts", "src/browser/profile.ts", "src/browser/login.ts",
  "src/browser/handoff.ts", "src/chatgpt/conversation.ts", "src/chatgpt/locators.ts", "src/chatgpt/submit.ts",
  "src/chatgpt/response-anchor.ts", "src/monitor/state-machine.ts", "src/monitor/dom-observer.ts", "src/monitor/evidence.ts",
  "src/monitor/watchdog.ts", "src/monitor/structure-error.ts", "src/images/discovery.ts", "src/images/download.ts",
  "src/images/validate.ts", "src/images/preview.ts", "src/events/image-ready.ts", "src/events/progress.ts",
  "src/events/reconcile.ts", "src/persistence/recover.ts", "src/commands/install.ts", "tests/fixtures/chatgpt-page/index.html",
  "tests/integration/web-flow.test.ts", ".github/workflows/windows.yml"
];

test("T38 maps every internal implementation task T01-T38 to tests and files", () => {
  for (const file of IMPLEMENTED_FILES) assert.equal(existsSync(file), true, `missing ${file}`);
  const tests = [
    "tests/smoke/project-layout.test.ts", "tests/skill/metadata.test.ts", "tests/input/parse-request.test.ts", "tests/input/ambiguity.test.ts",
    "tests/config/config.test.ts", "tests/platform/paths.test.ts", "tests/platform/chrome.test.ts", "tests/events/events.test.ts",
    "tests/tasks/task-model.test.ts", "tests/persistence/task-store.test.ts", "tests/diagnostics/diagnostics.test.ts", "tests/browser/profile-lock.test.ts",
    "tests/tasks/orchestration.test.ts", "tests/browser/session.test.ts", "tests/chatgpt/adapter.test.ts", "tests/monitor/monitor.test.ts",
    "tests/images/images.test.ts", "tests/events/delivery.test.ts", "tests/persistence/recover.test.ts", "tests/cli/cli.test.ts", "tests/integration/web-flow.test.ts", "tests/contracts/coverage.test.ts"
  ].map((file) => readFileSync(file, "utf8")).join("\n");
  for (let id = 1; id <= 38; id += 1) assert.match(tests, new RegExp(`T${String(id).padStart(2, "0")}`), `T${id} has no test mapping`);
});

test("T39 Windows workflow runs all non-account gates without real ChatGPT credentials", () => {
  const workflow = readFileSync(".github/workflows/windows.yml", "utf8");
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /node-version: 22/);
  for (const command of ["npm ci", "npm run typecheck", "npm test", "npm run build"]) assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(workflow, /CHATGPT|OPENAI_API_KEY|password|cookie/i);
});

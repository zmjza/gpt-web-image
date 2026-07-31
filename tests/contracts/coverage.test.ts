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

const MANAGER_TASK_FILES: Record<string, readonly string[]> = {
  T43: ["src/profiles/registry.ts", "tests/profiles/manager.test.ts"],
  T44: ["src/profiles/directories.ts", "tests/profiles/directories.test.ts"],
  T45: ["src/profiles/manager.ts", "tests/profiles/manager.test.ts"],
  T46: ["src/profiles/migration.ts", "tests/profiles/directories.test.ts"],
  T47: ["src/profiles/manager.ts", "tests/profiles/manager.test.ts"],
  T48: ["src/browser/membership.ts", "tests/browser/membership-lease.test.ts"],
  T49: ["src/browser/browser-lease.ts", "tests/browser/membership-lease.test.ts"],
  T50: ["src/profiles/binding.ts", "tests/tasks/profile-binding.test.ts"],
  T51: ["src/manager/server.ts", "tests/manager/server.test.ts"],
  T52: ["src/manager/public/app.js", "tests/manager/ui-shell.test.ts"],
  T53: ["src/profiles/manager.ts", "tests/profiles/manager.test.ts"],
  T54: ["src/profiles/backup.ts", "tests/profiles/manager.test.ts"],
  T55: ["src/profiles/backup.ts", "tests/profiles/manager.test.ts"],
  T56: ["liran_docs/10-UI壳接入清单.md", "tests/manager/ui-shell.test.ts"],
  T57: ["tests/profiles/manager.test.ts", "tests/manager/server.test.ts"],
  T58: [".github/workflows/windows.yml", "tests/profiles/directories.test.ts"],
  T59: ["docs/pitfalls/manager-ui-shell.md", "liran_docs/04-开发追踪.md"],
  T62: ["src/manager/public/app.js", "tests/manager/ui-shell.test.ts"],
  T63: ["src/images/manager-query.ts", "tests/images/manager-domain.test.ts"],
  T64: ["src/images/manager-scanner.ts", "tests/images/manager-domain.test.ts"],
  T65: ["src/images/manager-model.ts", "src/images/manager-index-store.ts"],
  T66: ["src/images/manager-scanner.ts", "tests/images/manager-domain.test.ts"],
  T67: ["src/images/manager-attribution.ts", "tests/images/manager-domain.test.ts"],
  T68: ["src/images/manager-query.ts", "tests/images/manager-domain.test.ts"],
  T69: ["src/images/manager-query.ts", "tests/images/manager-domain.test.ts"],
  T70: ["src/images/manager-query.ts", "tests/images/manager-domain.test.ts"],
  T71: ["src/images/manager-thumbnail.ts", "tests/images/manager-domain.test.ts"],
  T72: ["src/images/manager-files.ts", "tests/images/manager-domain.test.ts"],
  T73: ["src/images/manager-scanner.ts", "src/manager/public/app.js"],
  T74: ["src/manager/server.ts", "tests/manager/server.test.ts"],
  T75: ["design/stitch/18230660193198829480/52f2dc24e0cd4878861f315a7edefa28/index.html", "tests/manager/ui-shell.test.ts"],
  T76: ["src/manager/public/index.html", "src/manager/public/styles.css"],
  T77: ["tests/images/manager-domain.test.ts", "tests/manager/server.test.ts"]
};

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

test("T57/T77 maps manager implementation tasks T43-T59 and T62-T77 to concrete files", () => {
  const expected = [
    ...Array.from({ length: 17 }, (_, index) => `T${43 + index}`),
    ...Array.from({ length: 16 }, (_, index) => `T${62 + index}`)
  ];
  assert.deepEqual(Object.keys(MANAGER_TASK_FILES), expected);
  for (const [taskId, files] of Object.entries(MANAGER_TASK_FILES)) {
    assert.ok(files.length >= 2, `${taskId} must map implementation and evidence`);
    for (const file of files) assert.equal(existsSync(file), true, `${taskId} missing ${file}`);
  }
});

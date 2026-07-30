import test from "node:test";
import assert from "node:assert/strict";
import { isWithinRoot, sanitizeFileName, taskOutputDir } from "../../src/platform/paths.js";

test("T06 sanitizes Windows reserved names and unsafe characters", () => {
  assert.equal(sanitizeFileName("CON: 海报?.png"), "CON_ 海报_.png");
  assert.equal(sanitizeFileName("AUX"), "AUX_");
});

test("T06 keeps task output under the selected root", () => {
  const root = "/tmp/中文 项目";
  const output = taskOutputDir(root, new Date("2026-07-30T00:00:00Z"), "task_123");
  assert.match(output, /gpt-web-images[\\/]2026-07-30[\\/]task_123$/);
  assert.equal(isWithinRoot(root, output), true);
  assert.equal(isWithinRoot(root, "/tmp/中文 项目/../outside"), false);
});

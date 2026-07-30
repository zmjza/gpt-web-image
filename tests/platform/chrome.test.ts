import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { inspectChrome } from "../../src/platform/chrome.js";
import { runDoctor } from "../../src/commands/doctor.js";

test("T07 reports a missing explicit Chrome path without fallback", () => {
  const report = inspectChrome({ platform: "win32", configuredPath: "Z:/missing/chrome.exe" });
  assert.equal(report.available, false);
  assert.equal(report.path, "Z:/missing/chrome.exe");
  assert.equal(report.reason, "configured_path_missing");
});

test("T07 doctor output is machine-readable and sanitized", () => {
  const report = runDoctor({ platform: "win32", configuredPath: "Z:/missing/chrome.exe", profileDir: "C:/Users/Test Profile", outputDir: "C:/tmp/images" });
  assert.equal(typeof report.node.version, "string");
  assert.equal(report.chrome.available, false);
  assert.equal("cookie" in report, false);
  assert.equal(report.profile.retentionPolicy, "never-auto-delete");
  assert.equal(report.profile.markerPath, resolve("C:/Users/Test Profile", ".gpt-web-image-profile.json"));
});

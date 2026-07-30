import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("T01 project skeleton exposes build, typecheck and test scripts", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
  assert.equal(existsSync("src/cli.ts"), true);
  assert.equal(existsSync("tsconfig.json"), true);
  assert.equal(existsSync(".gitignore"), true);
  assert.ok(packageJson.scripts?.build);
  assert.ok(packageJson.scripts?.typecheck);
  assert.ok(packageJson.scripts?.test);
});

test("source and test diagnostics directories are not ignored by Git", () => {
  for (const path of ["src/diagnostics/redact.ts", "tests/diagnostics/diagnostics.test.ts"]) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", path]);
    assert.equal(result.status, 1, `${path} must be included in the repository`);
  }
});

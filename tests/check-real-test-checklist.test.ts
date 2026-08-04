import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(".");
const checker = resolve("scripts/check_real_test_checklist.py");
const python = process.platform === "win32" ? "python" : "python3";
const requiredRows = [
  "2.1", "2.2", "2.3", "3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "4.2",
  "5.1", "5.2", "5.3", "5.4", "MP-1", "MP-2", "MP-3", "MP-4", "MP-5", "MP-6",
  "IMG-1", "IMG-2", "IMG-3", "IMG-4", "IMG-5", "IMG-6"
];

function checklist(overrides: Partial<Record<string, string>> = {}): string {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const rows = requiredRows.map((id) => {
    const result = overrides[id] ?? (id.startsWith("MP-") || id.startsWith("IMG-") ? "真实/隔离证据通过" : "✅ 真实验证通过");
    return `| ${id} | macOS | 验收 | ${result} |`;
  }).join("\n");
  return [
    "# 验收清单",
    `## 当前轮次收口证据\n- 当前提交：\`${sha}\`\n- Windows Actions：run \`30944073691\` / job \`92109518018\`，状态 \`completed/success\`。\n- macOS 真机、隔离创建/导入和页面样式检查：已完成。`,
    "## 范围豁免\n- 4.3、4.4 不纳入本轮验收。\n- Windows x64 用户真机本轮豁免（未执行）。",
    rows
  ].join("\n");
}

function runChecker(markdown: string, requireComplete = true, cwd = root) {
  const directory = mkdtempSync(join(tmpdir(), "gwi-checklist-test-"));
  const file = join(directory, "checklist.md");
  writeFileSync(file, markdown, "utf8");
  try {
    return spawnSync(python, [checker, file, ...(requireComplete ? ["--require-complete"] : [])], {
      cwd,
      encoding: "utf8"
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("real test checklist checker accepts complete in-scope evidence", () => {
  const result = runChecker(checklist());
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("real test checklist checker rejects an in-scope row without evidence", () => {
  const result = runChecker(checklist({ "3.2": "本轮待验收" }));
  assert.notEqual(result.status, 0, "a missing required result must fail the gate");
  assert.match(`${result.stdout}\n${result.stderr}`, /3\.2/);
});

test("real test checklist checker accepts an evidence commit that is an ancestor of HEAD", () => {
  const directory = mkdtempSync(join(tmpdir(), "gwi-checklist-git-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: directory });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: directory });
    execFileSync("git", ["config", "user.name", "Checklist Test"], { cwd: directory });
    writeFileSync(join(directory, "seed.txt"), "seed\n", "utf8");
    execFileSync("git", ["add", "seed.txt"], { cwd: directory });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: directory });
    const parent = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
    writeFileSync(join(directory, "current.txt"), "current\n", "utf8");
    execFileSync("git", ["add", "current.txt"], { cwd: directory });
    execFileSync("git", ["commit", "-q", "-m", "current"], { cwd: directory });

    const markdown = checklist().replace(/当前提交：`[0-9a-f]{40}`/, `当前提交：\`${parent}\``);
    const result = runChecker(markdown, true, directory);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("real test checklist checker rejects an unrelated evidence commit", () => {
  const markdown = checklist().replace(/当前提交：`[0-9a-f]{40}`/, "当前提交：`0000000000000000000000000000000000000000`");
  const result = runChecker(markdown);
  assert.notEqual(result.status, 0, "an unrelated evidence commit must fail the gate");
  assert.match(`${result.stdout}\n${result.stderr}`, /不是当前提交或其祖先/);
});

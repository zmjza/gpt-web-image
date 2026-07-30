import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli.js";
import { installUserSkill } from "../../src/commands/install.js";

test("T35 routes doctor and rejects unknown commands with documented exit codes", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-doctor-"));
  const configPath = join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ profileDir: join(root, "profile"), fallbackOutputDir: join(root, "output") }));
  const out: string[] = []; const err: string[] = [];
  const code = await runCli(["doctor", "--json", "--config", configPath], { stdout: (line) => out.push(line), stderr: (line) => err.push(line) });
  assert.equal(code, 0);
  const report = JSON.parse(out[0] ?? "{}");
  assert.equal(typeof report.node.version, "string");
  assert.equal(report.profile.retentionPolicy, "never-auto-delete");
  assert.equal(report.profile.markerPath, join(root, "profile", ".gpt-web-image-profile.json"));
  assert.equal(await runCli(["unknown"], { stdout: () => undefined, stderr: () => undefined }), 20);
});

test("T35 executes the documented relative CLI entrypoint", async () => {
  const child = spawn(process.execPath, ["dist/src/cli.js", "--version"], { cwd: process.cwd() });
  const stdout: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  assert.equal(exitCode, 0);
  assert.match(Buffer.concat(stdout).toString("utf8"), /gpt-web-image 0\.1\.1/);
});

test("T36 installs and upgrades an owned user skill without overwriting foreign data", async () => {
  const home = await mkdtemp(join(tmpdir(), "gwi-home-"));
  const first = await installUserSkill({ homeDir: home, projectRoot: process.cwd() });
  assert.equal(first.action, "installed");
  assert.equal((await installUserSkill({ homeDir: home, projectRoot: process.cwd() })).action, "upgraded");
  const foreignHome = await mkdtemp(join(tmpdir(), "gwi-home-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  const foreign = join(foreignHome, ".codex", "skills", "gpt-web-image");
  await mkdir(foreign, { recursive: true }); await writeFile(join(foreign, "SKILL.md"), "foreign");
  await assert.rejects(() => installUserSkill({ homeDir: foreignHome, projectRoot: process.cwd() }), /不属于本项目/);
});

import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const MARKER = ".gpt-web-image-install.json";
export interface InstallOptions { homeDir?: string | undefined; projectRoot?: string | undefined; targetDir?: string | undefined; }
export interface InstallResult { action: "installed" | "upgraded"; targetDir: string; backupDir: string | null; }
async function exists(path: string): Promise<boolean> { return stat(path).then(() => true, () => false); }

export async function installUserSkill(options: InstallOptions = {}): Promise<InstallResult> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const targetDir = resolve(options.targetDir ?? join(options.homeDir ?? homedir(), ".codex", "skills", "gpt-web-image"));
  const sourceSkill = join(projectRoot, ".agents", "skills", "gpt-web-image");
  if (!(await exists(join(sourceSkill, "SKILL.md"))) || !(await exists(join(projectRoot, "agents", "openai.yaml")))) throw new Error("安装源缺少 Skill 元数据");
  await mkdir(dirname(targetDir), { recursive: true });
  const targetExists = await exists(targetDir);
  if (targetExists) {
    try {
      const marker = JSON.parse(await readFile(join(targetDir, MARKER), "utf8")) as { owner?: string };
      if (marker.owner !== "gpt-web-image") throw new Error("owner mismatch");
    } catch { throw new Error("目标同名 Skill 不属于本项目，拒绝覆盖"); }
  }
  const staging = join(dirname(targetDir), `.gpt-web-image.install-${randomUUID()}`);
  await mkdir(staging);
  await cp(sourceSkill, staging, { recursive: true, force: false });
  await mkdir(join(staging, "agents"));
  await cp(join(projectRoot, "agents", "openai.yaml"), join(staging, "agents", "openai.yaml"), { force: false });
  await writeFile(join(staging, MARKER), `${JSON.stringify({ schemaVersion: "1", owner: "gpt-web-image", projectRoot, installedAt: new Date().toISOString() }, null, 2)}\n`, { flag: "wx" });
  let backupDir: string | null = null;
  if (targetExists) { backupDir = `${targetDir}.backup-${Date.now()}`; await rename(targetDir, backupDir); }
  try { await rename(staging, targetDir); }
  catch (error) { if (backupDir) await rename(backupDir, targetDir).catch(() => undefined); throw error; }
  return { action: targetExists ? "upgraded" : "installed", targetDir, backupDir };
}

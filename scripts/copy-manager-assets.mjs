import { execFile } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const lockDirectory = resolve("src/manager/public/.manager-assets-build-lock");
for (let attempt = 0; ; attempt += 1) {
  try { await mkdir(lockDirectory); break; }
  catch (error) {
    if (error?.code !== "EEXIST" || attempt >= 200) throw error;
    const lock = await stat(lockDirectory).catch(() => null);
    if (lock && Date.now() - lock.mtimeMs > 5 * 60_000) await rm(lockDirectory, { recursive: true, force: true });
    await delay(50);
  }
}

try {
  await promisify(execFile)(process.execPath, [
    resolve("node_modules/tailwindcss/lib/cli.js"),
    "-c", resolve("tailwind.config.cjs"),
    "-i", resolve("src/manager/public/styles.css"),
    "-o", resolve("src/manager/public/manager.css"),
    "--minify"
  ], { env: { ...process.env, BROWSERSLIST_IGNORE_OLD_DATA: "true" } });

  const source = resolve("node_modules/@fortawesome/fontawesome-free");
  const target = resolve("src/manager/public/vendor/fontawesome");
  await mkdir(target, { recursive: true });
  await Promise.all([
    cp(resolve(source, "css"), resolve(target, "css"), { recursive: true, force: true }),
    cp(resolve(source, "webfonts"), resolve(target, "webfonts"), { recursive: true, force: true })
  ]);
} finally {
  await rm(lockDirectory, { recursive: true, force: true });
}

#!/usr/bin/env node

import { join, resolve } from "node:path";
import { loadConfig } from "../dist/src/config/load.js";
import { startManagerServer } from "../dist/src/manager/server.js";
import { openProfileRuntime } from "../dist/src/profiles/runtime.js";

const config = await loadConfig();
const runtime = await openProfileRuntime(config.profileDir);
const server = await startManagerServer({
  runtime,
  outputRoot: join(resolve(config.fallbackOutputDir), "gpt-web-images"),
  backupRoot: join(runtime.dataRoot, "backups"),
  chromeExecutablePath: config.chromeExecutablePath,
  port: Number(process.env.GPT_WEB_IMAGE_MANAGER_PORT ?? process.env.GPT_WEB_IMAGE_PREVIEW_PORT ?? 4173)
});

process.stdout.write(`GPT Web Image manager: ${server.url}\n`);

async function shutdown() {
  await server.close();
  process.exitCode = 0;
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

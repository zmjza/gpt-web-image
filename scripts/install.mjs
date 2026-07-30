#!/usr/bin/env node
import { installUserSkill } from "../dist/src/commands/install.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

installUserSkill({ projectRoot: resolve(dirname(fileURLToPath(import.meta.url)), "..") })
  .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
  .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });

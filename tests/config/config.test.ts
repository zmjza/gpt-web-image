import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, validateConfig } from "../../src/config/schema.js";
import { loadConfig } from "../../src/config/load.js";

test("T05 exposes safe defaults", () => {
  assert.equal(DEFAULT_CONFIG.defaultImageCount, 1);
  assert.equal(DEFAULT_CONFIG.maxSupplementRounds, 3);
  assert.equal(DEFAULT_CONFIG.pageReadyTimeoutMs, 60000);
  assert.equal(DEFAULT_CONFIG.normalBrowserMode, "headless");
  assert.notEqual(DEFAULT_CONFIG.profileDir, "");
  assert.notEqual(DEFAULT_CONFIG.fallbackOutputDir, "");
});

test("T05 rejects unknown and sensitive config fields", () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, unknown: true }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, cookie: "secret" }));
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, defaultImageCount: 11 }));
});

test("T05 applies user config and command overrides in order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gpt-web-image-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ defaultImageCount: 4, maxSupplementRounds: 2 }));
  const config = await loadConfig({ configPath, overrides: { defaultImageCount: 7 } });
  assert.equal(config.defaultImageCount, 7);
  assert.equal(config.maxSupplementRounds, 2);
});

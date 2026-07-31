import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { scanImageIndex } from "../../src/images/manager-scanner.js";
import { queryImages } from "../../src/images/manager-query.js";

test("T64-T69 scans one profile, rejects symlink escape and sorts newest first", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-index-"));
  const outputRoot = join(root, "outputs");
  await mkdir(outputRoot, { recursive: true });
  await sharp({ create: { width: 48, height: 32, channels: 4, background: "#22c55e" } }).png().toFile(join(outputRoot, "older.png"));
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  await sharp({ create: { width: 64, height: 64, channels: 4, background: "#2563eb" } }).png().toFile(join(outputRoot, "newer.png"));
  await writeFile(join(outputRoot, "broken.png"), "not-an-image");
  const index = await scanImageIndex({ profileId: "profile-a", outputRoot });
  assert.equal(index.records.length, 3);
  assert.equal(index.records.find((record) => record.fileName === "broken.png")?.status, "corrupt");
  const result = queryImages(index, { keyword: "", statuses: [], formats: [], generationTypes: [], projectIds: [], taskIds: [], from: null, to: null, orientation: null }, "generatedAt_desc", 1, 20);
  assert.equal(result.items[0]?.fileName, "newer.png");
  assert.equal(result.items.every((record) => record.profileId === "profile-a"), true);
});

test("T68 combines keyword, format, status and orientation filters", async () => {
  const root = await mkdtemp(join(tmpdir(), "gpt-web-image-query-"));
  await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).jpeg().toFile(join(root, "wide-project.jpg"));
  const index = await scanImageIndex({ profileId: "p1", outputRoot: root });
  const result = queryImages(index, { keyword: "wide", statuses: ["completed"], formats: ["jpg"], generationTypes: [], projectIds: [], taskIds: [], from: null, to: null, orientation: "landscape" }, "generatedAt_desc", 1, 10);
  assert.equal(result.total, 1);
});

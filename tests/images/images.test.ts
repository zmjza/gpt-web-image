import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageDiscovery } from "../../src/images/discovery.js";
import { downloadOriginal } from "../../src/images/download.js";
import { validateImageFile, ImageValidationError } from "../../src/images/validate.js";
import { hashFile } from "../../src/images/hash.js";
import { createOutputLayout } from "../../src/images/output-layout.js";
import { createPngPreview } from "../../src/images/preview.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("T28 only stabilizes new loaded images inside the response anchor", () => {
  const discovery = new ImageDiscovery(["old"], 1000);
  const snapshot = [
    { anchorId: "current", fingerprint: "old", loaded: true, width: 100, height: 100, resourceUrl: "old" },
    { anchorId: "other", fingerprint: "foreign", loaded: true, width: 100, height: 100, resourceUrl: "x" },
    { anchorId: "current", fingerprint: "new", loaded: true, width: 1024, height: 1024, resourceUrl: "new" },
    { anchorId: "current", fingerprint: "zero", loaded: true, width: 0, height: 0, resourceUrl: "z" }
  ];
  assert.deepEqual(discovery.observe("current", snapshot, 0), []);
  assert.deepEqual(discovery.observe("current", snapshot, 1000).map((candidate) => candidate.fingerprint), ["new"]);
});

test("T29 writes downloads through a partial file and never accepts screenshot fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-download-"));
  const path = join(root, "result.png");
  const result = await downloadOriginal({ destinationPath: path, downloadEvent: async () => PNG });
  assert.equal(result.method, "download_event");
  assert.deepEqual(await readFile(path), PNG);
  await assert.rejects(() => downloadOriginal({ destinationPath: join(root, "bad.png") }), /下载来源/);
});

test("T30 performs real decode, dimensions and SHA-256 validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-validate-"));
  const path = join(root, "one.png");
  await writeFile(path, PNG);
  const result = await validateImageFile(path, "image/png");
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.equal(result.sha256, await hashFile(path));
  await writeFile(join(root, "html.png"), "<html>error</html>");
  await assert.rejects(() => validateImageFile(join(root, "html.png")), ImageValidationError);
});

test("T31 separates output directories and preserves original bytes while creating preview", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-layout-"));
  const layout = await createOutputLayout(root, new Date("2026-07-30T00:00:00Z"), "task_1");
  assert.match(layout.originalDir, /original$/);
  assert.match(layout.previewDir, /preview$/);
  const source = join(layout.originalDir, "source.png");
  const preview = join(layout.previewDir, "source.png");
  await writeFile(source, PNG);
  await createPngPreview(source, preview);
  assert.deepEqual(await readFile(source), PNG);
  const checked = await validateImageFile(preview, "image/png");
  assert.equal(checked.width, 1);
});

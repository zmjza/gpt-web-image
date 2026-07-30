import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventWriter } from "../../src/events/writer.js";
import { ImageReadyEmitter } from "../../src/events/image-ready.js";
import { ProgressThrottle } from "../../src/events/progress.js";
import { reconcileResults } from "../../src/events/reconcile.js";
import type { ImageResult } from "../../src/images/validate.js";

function result(path: string): ImageResult { return { resultId: "r1", originalPath: path, previewPath: null, mimeType: "image/png", width: 1, height: 1, byteLength: 68, sha256: "a".repeat(64) }; }

test("T32 emits each validated image immediately and exactly once", () => {
  const lines: string[] = [];
  const emitter = new ImageReadyEmitter(new EventWriter({ stdout: (line) => lines.push(line), now: () => new Date("2026-07-30T00:00:00Z") }));
  assert.equal(emitter.emit("t1", result("/tmp/r1.png"), 1, 2), true);
  assert.equal(emitter.emit("t1", result("/tmp/r1.png"), 1, 2), false);
  assert.equal(JSON.parse(lines[0] ?? "{}").type, "image_ready");
});

test("T33 throttles duplicate progress and marks missing files uncertain", async () => {
  const throttle = new ProgressThrottle(1000);
  assert.equal(throttle.shouldEmit({ state: "generating", completed: 0, message: "生成中" }, 0), true);
  assert.equal(throttle.shouldEmit({ state: "generating", completed: 0, message: "生成中" }, 100), false);
  assert.equal(throttle.shouldEmit({ state: "partial", completed: 1, message: "已有结果" }, 101), true);
  const dir = await mkdtemp(join(tmpdir(), "gwi-reconcile-"));
  const path = join(dir, "one.png"); await writeFile(path, "x");
  assert.equal((await reconcileResults([result(path)], new Set(["r1"]), 1)).state, "succeeded");
  assert.equal((await reconcileResults([result(join(dir, "missing.png"))], new Set(["r1"]), 1)).state, "result_uncertain");
});

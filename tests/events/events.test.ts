import test from "node:test";
import assert from "node:assert/strict";
import { EventWriter } from "../../src/events/writer.js";

test("T08 writes one JSON object per line with increasing sequence", () => {
  const lines: string[] = [];
  const writer = new EventWriter({ stdout: (line) => lines.push(line) });
  writer.write({ taskId: "task_1", type: "state", state: "ready", message: "页面就绪", completed: 0, target: 1, recoverable: true });
  writer.write({ taskId: "task_1", type: "progress", state: "generating", message: "生成中", completed: 0, target: 1, recoverable: true });
  assert.equal(lines.length, 2);
  const events = lines.map((line) => JSON.parse(line) as { seq: number; type: string });
  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
  assert.deepEqual(events.map((event) => event.type), ["state", "progress"]);
});

test("T08 rejects authentication-like payloads", () => {
  const writer = new EventWriter({ stdout: () => undefined });
  assert.throws(() => writer.write({ taskId: "task_1", type: "warning", state: "ready", message: "Cookie=secret", completed: 0, target: 1, recoverable: true }));
});

test("T08 requires the complete image_ready payload", () => {
  const lines: string[] = [];
  const writer = new EventWriter({ stdout: (line) => lines.push(line) });
  const event = writer.write({
    taskId: "task_1", type: "image_ready", state: "validating", message: "图片已校验", completed: 1, target: 1, recoverable: false,
    image: { resultId: "result_1", originalPath: "/tmp/result.png", previewPath: null, mimeType: "image/png", width: 1024, height: 768, byteLength: 1234, sha256: "a".repeat(64) }
  });
  assert.equal(event.image?.mimeType, "image/png");
  assert.equal(JSON.parse(lines[0] ?? "{}").image.byteLength, 1234);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRequest, RequestInputError } from "../../src/input/parse-request.js";

const fixtureDir = mkdtempSync(join(tmpdir(), "gpt-web-image-"));
const referencePath = join(fixtureDir, "参考图.png");
writeFileSync(referencePath, Buffer.from([137, 80, 78, 71]));

test("T03 parses generate with default count", () => {
  assert.deepEqual(parseRequest({ kind: "generate", prompt: "海边日落" }), {
    kind: "generate", prompt: "海边日落", count: 1, aspectRatio: null,
    referencePaths: [], sourceTaskId: null, sourceResultIds: [], modifyAll: false
  });
});

test("T03 parses edit and refine fields without side effects", () => {
  assert.deepEqual(parseRequest({ kind: "edit", prompt: "改成夜景", count: 4, referencePaths: [referencePath] }), {
    kind: "edit", prompt: "改成夜景", count: 4, aspectRatio: null,
    referencePaths: [referencePath], sourceTaskId: null, sourceResultIds: [], modifyAll: false
  });
  assert.deepEqual(parseRequest({ kind: "refine", prompt: "加一点雾", sourceTaskId: "task_1", sourceResultIds: ["result_1"] }), {
    kind: "refine", prompt: "加一点雾", count: 1, aspectRatio: null,
    referencePaths: [], sourceTaskId: "task_1", sourceResultIds: ["result_1"], modifyAll: false
  });
});

test("T03 enforces the three user-facing image routes", () => {
  assert.throws(() => parseRequest({ kind: "edit", prompt: "改成夜景" }), /图生图.*参考图|edit.*参考图/);
  assert.throws(() => parseRequest({ kind: "generate", prompt: "x", referencePaths: [referencePath] }), /generate.*参考图|图生图/);
  assert.throws(() => parseRequest({ kind: "refine", prompt: "加一点雾", sourceTaskId: "task_1", referencePaths: [referencePath] }), /refine.*本地|图改图/);
});

test("T03 rejects invalid count and missing references", () => {
  assert.throws(() => parseRequest({ kind: "generate", prompt: "x", count: 0 }), RequestInputError);
  assert.throws(() => parseRequest({ kind: "generate", prompt: "x", referencePaths: ["/missing/nope.png"] }), RequestInputError);
  assert.throws(() => parseRequest({ kind: "generate", prompt: "x", referencePaths: ["/tmp/file.txt"] }), RequestInputError);
});

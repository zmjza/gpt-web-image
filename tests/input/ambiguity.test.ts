import test from "node:test";
import assert from "node:assert/strict";
import { assessSubmission } from "../../src/input/ambiguity.js";

test("T04 blocks ambiguous multi-image targets", () => {
  const result = assessSubmission({ kind: "refine", prompt: "修改刚才那张", sourceResultIds: ["a", "b"], modifyAll: false });
  assert.equal(result.executable, false);
  assert.equal(result.question, "请指定要修改的图片编号，或明确要求全部修改。");
  assert.deepEqual(result.candidates, ["a", "b"]);
});

test("T04 permits a uniquely selected target and blocks conflicts", () => {
  assert.equal(assessSubmission({ kind: "refine", prompt: "改图", sourceResultIds: ["a"], modifyAll: false }).executable, true);
  assert.equal(assessSubmission({ kind: "generate", prompt: "x", count: 2, targetCount: 3 }).executable, false);
});

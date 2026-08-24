import test from "node:test";
import assert from "node:assert/strict";
import { createTaskRecord } from "../../src/tasks/model.js";
import { auditRecovery } from "../../src/persistence/recover.js";

test("T34 never resubmits an uncertain or already confirmed attempt", () => {
  const task = createTaskRecord({ prompt: "海报" }, "t1");
  assert.deepEqual(auditRecovery(task), { action: "resume_before_submit", maySubmit: true, reason: "no_attempt" });
  task.submission.attemptId = "a1";
  task.submission.clickedAt = new Date().toISOString();
  assert.deepEqual(auditRecovery(task), { action: "result_uncertain", maySubmit: false, reason: "submission_unconfirmed" });
  task.submission.confirmedAt = new Date().toISOString();
  task.chatUrl = "https://chatgpt.com/c/6a6e1566-0318-83ec-ac91-2c6536149b19";
  task.responseAnchor = { userTurnOrdinal: 1, assistantTurnOrdinal: 2, semanticFingerprint: "f", boundAt: new Date().toISOString() };
  assert.deepEqual(auditRecovery(task), { action: "resume_observer", maySubmit: false, reason: "anchored_submission" });
  task.state = "failed";
  assert.deepEqual(auditRecovery(task), { action: "resume_observer", maySubmit: false, reason: "anchored_submission" });
  task.state = "result_uncertain";
  assert.deepEqual(auditRecovery(task), { action: "resume_observer", maySubmit: false, reason: "anchored_submission" });
  task.state = "initializing";
  task.chatUrl = "https://chatgpt.com/c/WEB:0fc433b3-595d-4575-aef1-86007403a25e";
  assert.deepEqual(auditRecovery(task), { action: "result_uncertain", maySubmit: false, reason: "missing_context" });
});

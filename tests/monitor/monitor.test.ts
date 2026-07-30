import test from "node:test";
import assert from "node:assert/strict";
import { transitionTaskState, InvalidStateTransitionError } from "../../src/monitor/state-machine.js";
import { ActivityClock } from "../../src/monitor/dom-observer.js";
import { classifyEvidence } from "../../src/monitor/evidence.js";
import { evaluateWatchdog } from "../../src/monitor/watchdog.js";
import { createStructureFailure } from "../../src/monitor/structure-error.js";

test("T24 accepts explicit paths, rejects illegal jumps and protects terminal states", () => {
  assert.equal(transitionTaskState("initializing", "ready").state, "ready");
  assert.equal(transitionTaskState("ready", "submitting").state, "submitting");
  assert.throws(() => transitionTaskState("ready", "succeeded", { validatedFiles: 1, completed: 1, target: 1 }), InvalidStateTransitionError);
  assert.equal(transitionTaskState("validating", "succeeded", { validatedFiles: 1, completed: 1, target: 1 }).state, "succeeded");
  assert.throws(() => transitionTaskState("succeeded", "failed"), InvalidStateTransitionError);
  assert.throws(() => transitionTaskState("validating", "succeeded", { validatedFiles: 0, completed: 1, target: 1 }), /校验/);
});

test("T25 refreshes activity only for bound response changes and supports rebind", () => {
  const clock = new ActivityClock("anchor-1", 100);
  assert.equal(clock.observe({ anchorId: "other", kind: "animation" }, 200), false);
  assert.equal(clock.lastActivityAt, 100);
  assert.equal(clock.observe({ anchorId: "anchor-1", kind: "image" }, 250), true);
  assert.equal(clock.lastActivityAt, 250);
  clock.rebind("anchor-2", 300);
  assert.equal(clock.observe({ anchorId: "anchor-1", kind: "text" }, 350), false);
  assert.equal(clock.version, 0);
});

test("T26 fuses queue, generation, stable result and classified errors", () => {
  assert.equal(classifyEvidence({ queued: true, generating: false, responseComplete: false, stableImages: 0, target: 2 }), "queued");
  assert.equal(classifyEvidence({ queued: false, generating: true, responseComplete: false, stableImages: 1, target: 2 }), "partial");
  assert.equal(classifyEvidence({ queued: false, generating: false, responseComplete: true, stableImages: 2, target: 2 }), "stabilizing");
  assert.deepEqual(classifyEvidence({ queued: false, generating: false, responseComplete: false, stableImages: 0, target: 1, httpStatus: 429 }), { state: "failed", code: "RATE_LIMITED", recoverable: true });
  assert.deepEqual(classifyEvidence({ queued: false, generating: false, responseComplete: false, stableImages: 0, target: 1, loginRequired: true }), { state: "needs_login", code: "LOGIN_REQUIRED", recoverable: true });
});

test("T26 watchdog distinguishes startup, inactivity and hard limits", () => {
  const limits = { pageReadyTimeoutMs: 60, inactivityTimeoutMs: 240, hardTimeoutMs: 1200 };
  assert.equal(evaluateWatchdog({ startedAt: 0, lastActivityAt: 0, pageReadyAt: null, now: 61 }, limits), "PAGE_READY_TIMEOUT");
  assert.equal(evaluateWatchdog({ startedAt: 0, lastActivityAt: 100, pageReadyAt: 10, now: 341 }, limits), "INACTIVITY_TIMEOUT");
  assert.equal(evaluateWatchdog({ startedAt: 0, lastActivityAt: 1199, pageReadyAt: 10, now: 1201 }, limits), "HARD_TIMEOUT");
});

test("T27 stops safely and redacts structure diagnostics", () => {
  const result = createStructureFailure("LOCATOR_CONFLICT", { authorization: "Bearer secret", summary: "token=abc" });
  assert.equal(result.stopActions, true);
  assert.equal(result.state, "structure_changed");
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /secret|abc/);
});

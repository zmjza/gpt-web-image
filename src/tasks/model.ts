import { parseRequest, type NormalizedRequest, type RawRequest } from "../input/parse-request.js";
import { assertSafeTaskId } from "./id.js";
import type { TaskProfileBinding } from "../profiles/binding.js";

export const TASK_STATES = [
  "initializing", "needs_login", "ready", "submitting", "submitted", "queued", "generating", "partial", "stabilizing", "downloading", "validating", "succeeded", "partial_success", "failed", "timed_out", "cancelled", "recovering", "needs_human_verification", "structure_changed", "result_uncertain"
] as const;
export type TaskState = (typeof TASK_STATES)[number];

export interface SubmissionRecord {
  attemptId: string | null;
  baselineMessageCount: number;
  baselineImageFingerprints: string[];
  promptFingerprint: string;
  clickedAt: string | null;
  confirmedAt: string | null;
  confirmationEvidence: string[];
}

export interface ResponseAnchor {
  userTurnOrdinal: number;
  assistantTurnOrdinal: number;
  semanticFingerprint: string;
  boundAt: string;
}

export interface TaskModelSelection {
  modelKey: "gpt-5.6-sol-high" | "gpt-5.6-sol-medium" | "instant";
  label: string;
  priority: number;
  selectedAt: string;
}

export interface TaskReferenceEvidence {
  fileName: string;
  byteLength: number;
  sha256: string;
}

export interface TaskRecord {
  schemaVersion: "1";
  taskId: string;
  request: NormalizedRequest;
  state: TaskState;
  queuePosition: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  chatUrl: string | null;
  submission: SubmissionRecord;
  responseAnchor: ResponseAnchor | null;
  targetCount: number;
  supplementRound: number;
  results: unknown[];
  failures: unknown[];
  lastEventSeq: number;
  cancelRequestedAt: string | null;
  profileBinding: TaskProfileBinding | null;
  modelSelection: TaskModelSelection | null;
  modelSelections: TaskModelSelection[];
  referenceEvidence: TaskReferenceEvidence[];
}

export function isTaskState(value: string): value is TaskState {
  return (TASK_STATES as readonly string[]).includes(value);
}

export function createTaskRecord(input: RawRequest | NormalizedRequest, taskId: string, now = new Date(), profileBinding: TaskProfileBinding | null = null): TaskRecord {
  assertSafeTaskId(taskId);
  const request = parseRequest(input);
  const timestamp = now.toISOString();
  return {
    schemaVersion: "1",
    taskId,
    request,
    state: "initializing",
    queuePosition: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    finishedAt: null,
    chatUrl: null,
    submission: { attemptId: null, baselineMessageCount: 0, baselineImageFingerprints: [], promptFingerprint: "", clickedAt: null, confirmedAt: null, confirmationEvidence: [] },
    responseAnchor: null,
    targetCount: request.count,
    supplementRound: 0,
    results: [],
    failures: [],
    lastEventSeq: 0,
    cancelRequestedAt: null,
    profileBinding,
    modelSelection: null,
    modelSelections: [],
    referenceEvidence: []
  };
}

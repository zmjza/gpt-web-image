import { isTaskState, type TaskState } from "../tasks/model.js";

export const EVENT_TYPES = ["state", "progress", "image_ready", "warning", "terminal"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface ImageEventPayload {
  resultId: string;
  originalPath: string;
  previewPath: string | null;
  mimeType: string;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  provenance?: {
    userTurnOrdinal: number;
    assistantTurnOrdinal: number;
    mediaCardId: string;
    downloadMethod: "download_event" | "exposed_resource";
  };
}

export interface ProgressEvent {
  schemaVersion: "1";
  taskId: string;
  seq: number;
  timestamp: string;
  type: EventType;
  state: TaskState;
  message: string;
  completed: number;
  target: number;
  recoverable: boolean;
  image?: ImageEventPayload | null;
}

export type ProgressEventInput = Omit<ProgressEvent, "schemaVersion" | "seq" | "timestamp"> & { seq?: never; timestamp?: never; schemaVersion?: never };

export function validateProgressEvent(event: ProgressEvent): void {
  if (event.schemaVersion !== "1" || !event.taskId || !Number.isInteger(event.seq) || event.seq < 1) throw new Error("事件基础字段无效");
  if (!EVENT_TYPES.includes(event.type) || !isTaskState(event.state)) throw new Error("事件类型或状态无效");
  if (!Number.isInteger(event.completed) || !Number.isInteger(event.target) || event.completed < 0 || event.target < 0) throw new Error("事件计数无效");
  if (/cookie|authorization|token|password|set-cookie/i.test(event.message)) throw new Error("事件包含敏感信息");
  if (event.type === "image_ready" && !event.image) throw new Error("image_ready 缺少 image");
  if (event.image && (
    !event.image.originalPath || !event.image.resultId || !/^[a-f0-9]{64}$/i.test(event.image.sha256) ||
    !event.image.mimeType || !Number.isInteger(event.image.width) || event.image.width <= 0 ||
    !Number.isInteger(event.image.height) || event.image.height <= 0 ||
    !Number.isInteger(event.image.byteLength) || event.image.byteLength <= 0
  )) throw new Error("图片事件字段不完整");
  if (event.image?.provenance && (
    !Number.isInteger(event.image.provenance.userTurnOrdinal) || event.image.provenance.userTurnOrdinal < 1 ||
    !Number.isInteger(event.image.provenance.assistantTurnOrdinal) || event.image.provenance.assistantTurnOrdinal < 1 ||
    !event.image.provenance.mediaCardId || !["download_event", "exposed_resource"].includes(event.image.provenance.downloadMethod)
  )) throw new Error("图片事件来源证据无效");
}

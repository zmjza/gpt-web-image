import { existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { parseAspectRatio } from "../images/ratio.js";

export type RequestKind = "generate" | "edit" | "refine";

export interface RawRequest {
  kind?: RequestKind;
  prompt: string;
  count?: number;
  aspectRatio?: string | null;
  referencePaths?: string[];
  sourceTaskId?: string | null;
  sourceResultIds?: string[];
  modifyAll?: boolean;
}

export interface NormalizedRequest {
  kind: RequestKind;
  prompt: string;
  count: number;
  aspectRatio: string | null;
  referencePaths: string[];
  sourceTaskId: string | null;
  sourceResultIds: string[];
  modifyAll: boolean;
}

export class RequestInputError extends Error {
  public readonly code = "INVALID_INPUT";
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export function parseRequest(input: RawRequest): NormalizedRequest {
  if (!input || typeof input.prompt !== "string" || input.prompt.trim() === "") {
    throw new RequestInputError("prompt 不能为空");
  }
  const kind = input.kind ?? "generate";
  if (!["generate", "edit", "refine"].includes(kind)) {
    throw new RequestInputError("kind 必须是 generate、edit 或 refine");
  }
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    throw new RequestInputError("count 必须是 1 到 10 之间的整数");
  }
  const referencePaths = [...(input.referencePaths ?? [])];
  for (const referencePath of referencePaths) {
    if (!existsSync(referencePath) || !statSync(referencePath).isFile()) {
      throw new RequestInputError(`参考图不存在：${referencePath}`);
    }
    if (!IMAGE_EXTENSIONS.has(extname(referencePath).toLowerCase())) {
      throw new RequestInputError(`参考图格式不支持：${referencePath}`);
    }
  }
  if (kind === "edit" && referencePaths.length === 0) {
    throw new RequestInputError("图生图必须提供至少一张本地参考图；请使用 edit --reference");
  }
  if (kind === "generate" && referencePaths.length > 0) {
    throw new RequestInputError("generate 不能携带本地参考图；Codex 上传图片时必须改用图生图 edit");
  }
  if (kind === "refine" && referencePaths.length > 0) {
    throw new RequestInputError("图改图 refine 不能携带本地参考图，只能使用指定源任务的网页生成结果");
  }
  const aspectRatioInput = input.aspectRatio?.trim() || null;
  const aspectRatio = aspectRatioInput ? parseAspectRatio(aspectRatioInput).value : null;
  const sourceTaskId = input.sourceTaskId ?? null;
  const sourceResultIds = [...(input.sourceResultIds ?? [])];
  if (kind === "refine" && !sourceTaskId) {
    throw new RequestInputError("refine 必须提供 sourceTaskId");
  }
  return {
    kind,
    prompt: input.prompt.trim(),
    count,
    aspectRatio,
    referencePaths,
    sourceTaskId,
    sourceResultIds,
    modifyAll: input.modifyAll ?? false
  };
}

import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isWithinRoot } from "../platform/paths.js";
import type { ImageGeneratedAtSource, ImageGenerationType } from "./manager-model.js";

export interface ImageAttribution {
  profileId: string | null;
  taskId: string | null;
  taskName: string | null;
  projectId: string | null;
  projectName: string | null;
  promptSummary: string | null;
  generationType: ImageGenerationType;
  generatedAt: string | null;
  generatedAtSource: ImageGeneratedAtSource;
}

const NONE: ImageAttribution = {
  profileId: null,
  taskId: null,
  taskName: null,
  projectId: null,
  projectName: null,
  promptSummary: null,
  generationType: "other",
  generatedAt: null,
  generatedAtSource: "file_mtime"
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function generationType(value: unknown): ImageGenerationType {
  if (value === "generate") return "text_to_image";
  if (value === "edit") return "image_to_image";
  if (value === "refine") return "refine";
  return "other";
}

function truncateSummary(value: unknown): string | null {
  const text = stringOrNull(value);
  return text ? text.slice(0, 240) : null;
}

export async function readImageAttribution(
  filePath: string,
  outputRoot: string,
  cache: Map<string, ImageAttribution | null> = new Map()
): Promise<ImageAttribution> {
  const root = resolve(outputRoot);
  let current = dirname(resolve(filePath));
  while (isWithinRoot(root, current)) {
    const metadataPath = join(current, "task.json");
    const cached = cache.get(metadataPath);
    if (cached) return cached;
    try {
      const metadataStat = await lstat(metadataPath);
      if (metadataStat.isSymbolicLink() || !metadataStat.isFile()) throw new Error("task metadata is not a regular file");
      const canonicalMetadataPath = await realpath(metadataPath);
      if (!isWithinRoot(root, canonicalMetadataPath)) throw new Error("task metadata escapes output root");
      const raw = JSON.parse(await readFile(canonicalMetadataPath, "utf8")) as Record<string, unknown>;
      const request = raw.request && typeof raw.request === "object" ? raw.request as Record<string, unknown> : {};
      const project = raw.project && typeof raw.project === "object" ? raw.project as Record<string, unknown> : {};
      const taskId = stringOrNull(raw.taskId);
      const createdAt = stringOrNull(raw.createdAt);
      const attribution: ImageAttribution = {
        profileId: raw.profileBinding && typeof raw.profileBinding === "object" ? stringOrNull((raw.profileBinding as Record<string, unknown>).profileId) : null,
        taskId,
        taskName: stringOrNull(raw.taskName) ?? taskId,
        projectId: stringOrNull(raw.projectId) ?? stringOrNull(project.projectId) ?? stringOrNull(project.id),
        projectName: stringOrNull(raw.projectName) ?? stringOrNull(project.projectName) ?? stringOrNull(project.name),
        promptSummary: truncateSummary(request.prompt),
        generationType: generationType(request.kind),
        generatedAt: createdAt && !Number.isNaN(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : null,
        generatedAtSource: createdAt && !Number.isNaN(Date.parse(createdAt)) ? "task" : "file_mtime"
      };
      cache.set(metadataPath, attribution);
      return attribution;
    } catch {
      cache.set(metadataPath, null);
    }
    if (relative(root, current) === "") break;
    current = dirname(current);
  }
  return NONE;
}

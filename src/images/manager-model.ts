export const IMAGE_INDEX_SCHEMA_VERSION = "1" as const;
export const IMAGE_STATUSES = ["completed", "generating", "failed", "missing", "corrupt"] as const;
export const IMAGE_GENERATION_TYPES = ["text_to_image", "image_to_image", "refine", "other"] as const;
export const IMAGE_SORTS = [
  "generatedAt_desc", "generatedAt_asc", "projectActivity", "projectActivity_desc",
  "fileName", "fileName_asc", "fileName_desc", "byteSize", "byteSize_asc",
  "byteSize_desc", "dimensions", "dimensions_asc", "dimensions_desc"
] as const;
export const IMAGE_GROUPS = ["none", "project", "recent_project", "task", "date"] as const;

export type ImageStatus = (typeof IMAGE_STATUSES)[number];
export type ImageGenerationType = (typeof IMAGE_GENERATION_TYPES)[number];
export type ImageSort = (typeof IMAGE_SORTS)[number];
export type ImageGroupBy = (typeof IMAGE_GROUPS)[number];
export type ImageOrientation = "landscape" | "portrait" | "square";
export type ImageGeneratedAtSource = "task" | "file_mtime";

export interface ImageRecord {
  imageId: string;
  profileId: string;
  absolutePath: string;
  relativePath: string;
  fileName: string;
  generatedAt: string;
  generatedAtSource: ImageGeneratedAtSource;
  projectId: string | null;
  projectName: string | null;
  taskId: string | null;
  taskName: string | null;
  promptSummary: string | null;
  note: string | null;
  generationType: ImageGenerationType;
  format: string;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  status: ImageStatus;
  thumbnailPath: string | null;
  contentHash: string | null;
}

export interface ImageScanIssue {
  relativePath: string | null;
  code: "FILE_MISSING" | "FILE_CORRUPT" | "PERMISSION_DENIED" | "READ_FAILED" | "SYMLINK_IGNORED";
  message: string;
}

export interface ImageIndexStats {
  total: number;
  completed: number;
  generating: number;
  failed: number;
  missing: number;
  corrupt: number;
}

export interface ImageIndex {
  schemaVersion: typeof IMAGE_INDEX_SCHEMA_VERSION;
  indexVersion: number;
  profileId: string;
  outputRoot: string;
  scannedAt: string;
  records: ImageRecord[];
  issues: ImageScanIssue[];
  stats: ImageIndexStats;
}

export interface ImageFilter {
  keyword?: string;
  statuses?: readonly ImageStatus[];
  formats?: readonly string[];
  generationTypes?: readonly ImageGenerationType[];
  projectIds?: readonly string[];
  taskIds?: readonly string[];
  from?: string | null;
  to?: string | null;
  orientation?: ImageOrientation | null;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  minByteSize?: number | null;
  maxByteSize?: number | null;
}

export interface ImageGroup {
  key: string;
  label: string;
  latestActivityAt: string;
  unclassified: boolean;
  count: number;
  items: ImageRecord[];
}

export interface ImageQueryResult {
  profileId: string;
  sort: ImageSort;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: ImageRecord[];
  groups: ImageGroup[] | null;
}

export function isImageStatus(value: unknown): value is ImageStatus {
  return typeof value === "string" && (IMAGE_STATUSES as readonly string[]).includes(value);
}

export function isImageGenerationType(value: unknown): value is ImageGenerationType {
  return typeof value === "string" && (IMAGE_GENERATION_TYPES as readonly string[]).includes(value);
}

export function calculateImageIndexStats(records: readonly ImageRecord[]): ImageIndexStats {
  const stats: ImageIndexStats = { total: records.length, completed: 0, generating: 0, failed: 0, missing: 0, corrupt: 0 };
  for (const record of records) stats[record.status] += 1;
  return stats;
}

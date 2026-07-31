import type { ImageFilter, ImageGroup, ImageGroupBy, ImageIndex, ImageOrientation, ImageQueryResult, ImageRecord, ImageSort } from "./manager-model.js";

const UNCLASSIFIED = "unclassified";

function parseBoundary(value: string | null | undefined, name: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${name} 不是有效时间`);
  return parsed;
}

function matchesList(value: string | null, selected: readonly string[] | undefined): boolean {
  if (!selected?.length) return true;
  return selected.includes(value ?? UNCLASSIFIED);
}

function orientation(record: ImageRecord): ImageOrientation | null {
  if (record.width === null || record.height === null) return null;
  if (record.width === record.height) return "square";
  return record.width > record.height ? "landscape" : "portrait";
}

function nullableNumberWithin(value: number | null, minimum?: number | null, maximum?: number | null): boolean {
  if (minimum !== undefined && minimum !== null && (!Number.isFinite(minimum) || minimum < 0)) throw new Error("筛选下限必须是非负数");
  if (maximum !== undefined && maximum !== null && (!Number.isFinite(maximum) || maximum < 0)) throw new Error("筛选上限必须是非负数");
  if (minimum !== undefined && minimum !== null && maximum !== undefined && maximum !== null && minimum > maximum) throw new Error("筛选下限不能大于上限");
  if (value === null) return minimum == null && maximum == null;
  return (minimum == null || value >= minimum) && (maximum == null || value <= maximum);
}

function searchableText(record: ImageRecord): string {
  return [record.fileName, record.projectId, record.projectName, record.taskId, record.taskName, record.promptSummary, record.note]
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLocaleLowerCase();
}

function filterRecords(records: readonly ImageRecord[], filter: ImageFilter): ImageRecord[] {
  const from = parseBoundary(filter.from, "from");
  const to = parseBoundary(filter.to, "to");
  if (from !== null && to !== null && from > to) throw new Error("from 不能晚于 to");
  const keyword = filter.keyword?.trim().toLocaleLowerCase() ?? "";
  const formats = filter.formats?.map((format) => format.toLocaleLowerCase() === "jpeg" ? "jpg" : format.toLocaleLowerCase());
  return records.filter((record) => {
    const timestamp = Date.parse(record.generatedAt);
    return record.profileId !== ""
      && (!keyword || searchableText(record).includes(keyword))
      && (!filter.statuses?.length || filter.statuses.includes(record.status))
      && (!formats?.length || formats.includes(record.format.toLocaleLowerCase()))
      && (!filter.generationTypes?.length || filter.generationTypes.includes(record.generationType))
      && matchesList(record.projectId, filter.projectIds)
      && matchesList(record.taskId, filter.taskIds)
      && (from === null || timestamp >= from)
      && (to === null || timestamp <= to)
      && (!filter.orientation || orientation(record) === filter.orientation)
      && nullableNumberWithin(record.width, filter.minWidth, filter.maxWidth)
      && nullableNumberWithin(record.height, filter.minHeight, filter.maxHeight)
      && nullableNumberWithin(record.byteSize, filter.minByteSize, filter.maxByteSize);
  });
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
}

function compareNullableNumber(left: number | null, right: number | null, direction: 1 | -1): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return (left - right) * direction;
}

function deterministicTie(left: ImageRecord, right: ImageRecord): number {
  const time = Date.parse(right.generatedAt) - Date.parse(left.generatedAt);
  return time || left.imageId.localeCompare(right.imageId);
}

function availabilityRank(record: ImageRecord): number {
  if (record.status === "completed") return 0;
  if (record.status === "generating") return 1;
  if (record.status === "failed") return 2;
  if (record.status === "corrupt") return 3;
  return 4;
}

function projectActivity(records: readonly ImageRecord[]): Map<string, number> {
  const activity = new Map<string, number>();
  for (const record of records) {
    const key = record.projectId ?? UNCLASSIFIED;
    activity.set(key, Math.max(activity.get(key) ?? Number.NEGATIVE_INFINITY, Date.parse(record.generatedAt)));
  }
  return activity;
}

export function sortImages(records: readonly ImageRecord[], sort: ImageSort): ImageRecord[] {
  const activity = projectActivity(records);
  return [...records].sort((left, right) => {
    let primary = 0;
    switch (sort) {
      case "generatedAt_desc": primary = availabilityRank(left) - availabilityRank(right) || Date.parse(right.generatedAt) - Date.parse(left.generatedAt); break;
      case "generatedAt_asc": primary = availabilityRank(left) - availabilityRank(right) || Date.parse(left.generatedAt) - Date.parse(right.generatedAt); break;
      case "projectActivity":
      case "projectActivity_desc": primary = (activity.get(right.projectId ?? UNCLASSIFIED) ?? 0) - (activity.get(left.projectId ?? UNCLASSIFIED) ?? 0); break;
      case "fileName":
      case "fileName_asc": primary = compareText(left.fileName, right.fileName); break;
      case "fileName_desc": primary = compareText(right.fileName, left.fileName); break;
      case "byteSize":
      case "byteSize_desc": primary = compareNullableNumber(left.byteSize, right.byteSize, -1); break;
      case "byteSize_asc": primary = compareNullableNumber(left.byteSize, right.byteSize, 1); break;
      case "dimensions":
      case "dimensions_desc": primary = compareNullableNumber(left.width === null || left.height === null ? null : left.width * left.height, right.width === null || right.height === null ? null : right.width * right.height, -1); break;
      case "dimensions_asc": primary = compareNullableNumber(left.width === null || left.height === null ? null : left.width * left.height, right.width === null || right.height === null ? null : right.width * right.height, 1); break;
    }
    return primary || deterministicTie(left, right);
  });
}

export function groupImages(records: readonly ImageRecord[], groupBy: ImageGroupBy): ImageGroup[] | null {
  if (groupBy === "none") return null;
  const groups = new Map<string, ImageGroup>();
  for (const record of records) {
    let key: string;
    let label: string;
    if (groupBy === "project" || groupBy === "recent_project") {
      key = record.projectId ?? UNCLASSIFIED;
      label = record.projectName ?? "未归类";
    } else if (groupBy === "task") {
      key = record.taskId ?? UNCLASSIFIED;
      label = record.taskName ?? "未归类";
    } else {
      key = record.generatedAt.slice(0, 10);
      label = key;
    }
    const group = groups.get(key) ?? { key, label, latestActivityAt: record.generatedAt, unclassified: key === UNCLASSIFIED, count: 0, items: [] };
    group.items.push(record);
    group.count += 1;
    if (Date.parse(record.generatedAt) > Date.parse(group.latestActivityAt)) group.latestActivityAt = record.generatedAt;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.unclassified !== right.unclassified) return left.unclassified ? 1 : -1;
    if (groupBy === "project") return compareText(left.label, right.label) || left.key.localeCompare(right.key);
    return Date.parse(right.latestActivityAt) - Date.parse(left.latestActivityAt) || left.key.localeCompare(right.key);
  });
}

export function queryImages(index: ImageIndex, filter: ImageFilter = {}, sort: ImageSort = "generatedAt_desc", page = 1, pageSize = 50, groupBy: ImageGroupBy = "recent_project"): ImageQueryResult {
  if (!Number.isInteger(page) || page < 1) throw new Error("page 必须是正整数");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) throw new Error("pageSize 必须是 1 到 500 的整数");
  if (index.records.some((record) => record.profileId !== index.profileId)) throw new Error("图片索引包含其他 Profile 的记录");
  const sorted = sortImages(filterRecords(index.records, filter), sort);
  const total = sorted.length;
  const items = sorted.slice((page - 1) * pageSize, page * pageSize);
  return {
    profileId: index.profileId,
    sort,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    items,
    groups: groupImages(items, groupBy)
  };
}

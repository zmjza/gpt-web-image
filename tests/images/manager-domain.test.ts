import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { readImageAttribution } from "../../src/images/manager-attribution.js";
import { exportIndexedImage, getIndexedImageDetails } from "../../src/images/manager-files.js";
import { readImageIndex, writeImageIndex } from "../../src/images/manager-index-store.js";
import type { ImageIndex, ImageRecord } from "../../src/images/manager-model.js";
import { groupImages, queryImages } from "../../src/images/manager-query.js";
import { ImageScanError, scanImageIndex } from "../../src/images/manager-scanner.js";
import { createManagerThumbnail } from "../../src/images/manager-thumbnail.js";

function record(overrides: Partial<ImageRecord> & Pick<ImageRecord, "imageId" | "fileName" | "generatedAt">): ImageRecord {
  const base: ImageRecord = {
    imageId: overrides.imageId,
    profileId: "profile-a",
    absolutePath: `/controlled/${overrides.fileName}`,
    relativePath: overrides.fileName,
    fileName: overrides.fileName,
    generatedAt: overrides.generatedAt,
    generatedAtSource: "file_mtime",
    projectId: null,
    projectName: null,
    taskId: null,
    taskName: null,
    promptSummary: null,
    note: null,
    generationType: "other",
    format: "png",
    width: 10,
    height: 10,
    byteSize: 10,
    status: "completed",
    thumbnailPath: null,
    contentHash: null
  };
  return Object.assign(base, overrides);
}

function index(records: ImageRecord[]): ImageIndex {
  return {
    schemaVersion: "1",
    indexVersion: 1,
    profileId: "profile-a",
    outputRoot: "/controlled",
    scannedAt: "2026-07-30T12:00:00.000Z",
    records,
    issues: [],
    stats: {
      total: records.length,
      completed: records.filter((item) => item.status === "completed").length,
      missing: records.filter((item) => item.status === "missing").length,
      corrupt: records.filter((item) => item.status === "corrupt").length,
      failed: records.filter((item) => item.status === "failed").length,
      generating: records.filter((item) => item.status === "generating").length
    }
  };
}

const EMPTY_FILTER = {
  keyword: "",
  statuses: [],
  formats: [],
  generationTypes: [],
  projectIds: [],
  taskIds: [],
  from: null,
  to: null,
  orientation: null
} as const;

test("T64 rejects a directory symlink that escapes the controlled output root", async () => {
  const base = await mkdtemp(join(tmpdir(), "gwi-scope-"));
  const outputRoot = join(base, "outputs");
  const external = join(base, "external");
  await Promise.all([mkdir(outputRoot), mkdir(external)]);
  await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toFile(join(external, "secret.png"));
  await symlink(external, join(outputRoot, "escape"), process.platform === "win32" ? "junction" : "dir");

  await assert.rejects(
    () => scanImageIndex({ profileId: "profile-a", outputRoot }),
    (error: unknown) => error instanceof ImageScanError && error.code === "PROFILE_SCOPE_VIOLATION"
  );
});

test("T65-T67 keeps stable IDs, task attribution and missing records across incremental scans", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-incremental-"));
  const taskRoot = join(root, "2026-07-30", "task-42");
  const originalRoot = join(taskRoot, "original");
  await mkdir(originalRoot, { recursive: true });
  await writeFile(join(taskRoot, "task.json"), JSON.stringify({
    schemaVersion: "1",
    taskId: "task-42",
    state: "succeeded",
    request: { kind: "edit", prompt: "Neon skyline" },
    projectId: "project-7",
    projectName: "Launch"
  }));
  const imagePath = join(originalRoot, "result.png");
  await sharp({ create: { width: 20, height: 30, channels: 3, background: "blue" } }).png().toFile(imagePath);
  const first = await scanImageIndex({ profileId: "profile-a", outputRoot: root });
  const initial = first.records[0];
  assert.ok(initial);
  assert.equal(initial.taskId, "task-42");
  assert.equal(initial.projectId, "project-7");
  assert.equal(initial.generationType, "image_to_image");
  assert.equal(initial.promptSummary, "Neon skyline");

  await writeFile(imagePath, "removed while scanning");
  const corrupt = await scanImageIndex({ profileId: "profile-a", outputRoot: root, previousIndex: first });
  assert.equal(corrupt.records[0]?.imageId, initial.imageId);
  assert.equal(corrupt.records[0]?.status, "corrupt");

  await import("node:fs/promises").then(({ rename }) => rename(imagePath, join(root, "moved-away.txt")));
  const missing = await scanImageIndex({ profileId: "profile-a", outputRoot: root, previousIndex: corrupt });
  assert.equal(missing.records[0]?.imageId, initial.imageId);
  assert.equal(missing.records[0]?.status, "missing");
  assert.equal(missing.stats.missing, 1);
});

test("T73 indexes generating and failed tasks without image files as unavailable records", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-task-states-"));
  for (const [taskId, state] of [["task-generating", "generating"], ["task-failed", "failed"], ["task-complete", "succeeded"]] as const) {
    const taskRoot = join(root, taskId);
    await mkdir(taskRoot, { recursive: true });
    await writeFile(join(taskRoot, "task.json"), JSON.stringify({
      schemaVersion: "1",
      taskId,
      state,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:01:00.000Z",
      request: { kind: "generate", prompt: taskId },
      profileBinding: { profileId: "profile-a", profileDir: join(root, "chrome"), boundAt: "2026-07-31T00:00:00.000Z" }
    }));
  }

  const scanned = await scanImageIndex({ profileId: "profile-a", outputRoot: root, includeUnbound: false });
  assert.deepEqual(scanned.records.map((item) => [item.taskId, item.status]), [
    ["task-failed", "failed"],
    ["task-generating", "generating"]
  ]);
  assert.equal(scanned.stats.generating, 1);
  assert.equal(scanned.stats.failed, 1);

  const details = await getIndexedImageDetails(scanned, scanned.records[0]!.imageId);
  assert.equal(details.available, false);
  assert.deepEqual(details.actions, { preview: false, copyPath: false, openDirectory: true, export: false });
});

test("T63/T67 isolates a shared output root by the task Profile binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-profile-images-"));
  for (const profileId of ["profile-a", "profile-b"]) {
    const taskRoot = join(root, profileId);
    await mkdir(taskRoot, { recursive: true });
    await writeFile(join(taskRoot, "task.json"), JSON.stringify({
      schemaVersion: "1",
      taskId: `task-${profileId}`,
      createdAt: "2026-07-31T00:00:00.000Z",
      request: { kind: "generate", prompt: profileId },
      profileBinding: { profileId, profileDir: join(root, profileId, "chrome"), boundAt: "2026-07-31T00:00:00.000Z" }
    }));
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toFile(join(taskRoot, `${profileId}.png`));
  }
  const selected = await scanImageIndex({ profileId: "profile-a", outputRoot: root });
  assert.deepEqual(selected.records.map((item) => item.fileName), ["profile-a.png"]);
});

test("T64 never follows a task metadata symlink outside the output root", async () => {
  const base = await mkdtemp(join(tmpdir(), "gwi-metadata-scope-"));
  const outputRoot = join(base, "outputs");
  const taskRoot = join(outputRoot, "task");
  await mkdir(taskRoot, { recursive: true });
  const externalMetadata = join(base, "external-task.json");
  await writeFile(externalMetadata, JSON.stringify({ taskId: "external", projectName: "Must not leak", request: { prompt: "outside secret" } }));
  await symlink(externalMetadata, join(taskRoot, "task.json"), "file");
  await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toFile(join(taskRoot, "safe.png"));

  const attribution = await readImageAttribution(join(taskRoot, "safe.png"), outputRoot);
  assert.equal(attribution.taskId, null);
  assert.equal(attribution.projectName, null);
  assert.equal(attribution.promptSummary, null);
});

test("T68 applies time, dimensions and keyword metadata filters together", () => {
  const records = [record({
    imageId: "match",
    fileName: "cover.png",
    generatedAt: "2026-07-30T10:00:00.000Z",
    projectId: "p1",
    projectName: "Campaign",
    taskId: "t1",
    taskName: "Hero batch",
    promptSummary: "Ocean launch",
    generationType: "text_to_image",
    width: 1600,
    height: 900,
    byteSize: 200
  }), record({ imageId: "old", fileName: "old.png", generatedAt: "2026-01-01T00:00:00.000Z", width: 100, height: 200 })];
  const result = queryImages(index(records), {
    ...EMPTY_FILTER,
    keyword: "ocean",
    projectIds: ["p1"],
    taskIds: ["t1"],
    generationTypes: ["text_to_image"],
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-31T23:59:59.999Z",
    orientation: "landscape",
    minWidth: 1000,
    maxHeight: 1000,
    minByteSize: 100
  }, "generatedAt_desc", 1, 20);
  assert.deepEqual(result.items.map((item) => item.imageId), ["match"]);
});

test("T65 records the decoded image format instead of trusting the extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-format-"));
  const pngBytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
  await writeFile(join(root, "misnamed.jpg"), pngBytes);
  const scanned = await scanImageIndex({ profileId: "profile-a", outputRoot: root });
  assert.equal(scanned.records[0]?.format, "png");
});

test("T69 supports every planned sort with deterministic tie breaking", () => {
  const records = [
    record({ imageId: "b", fileName: "beta.png", generatedAt: "2026-07-30T10:00:00.000Z", projectId: "p1", byteSize: 20, width: 4, height: 5 }),
    record({ imageId: "a", fileName: "alpha.png", generatedAt: "2026-07-30T10:00:00.000Z", projectId: "p2", byteSize: 10, width: 8, height: 8 }),
    record({ imageId: "c", fileName: "charlie.png", generatedAt: "2026-07-31T10:00:00.000Z", projectId: "p1", byteSize: 30, width: 2, height: 3 })
  ];
  const source = index(records);
  assert.deepEqual(queryImages(source, EMPTY_FILTER, "generatedAt_desc", 1, 10).items.map((item) => item.imageId), ["c", "a", "b"]);
  assert.deepEqual(queryImages(source, EMPTY_FILTER, "generatedAt_asc", 1, 10).items.map((item) => item.imageId), ["a", "b", "c"]);
  assert.deepEqual(queryImages(source, EMPTY_FILTER, "projectActivity", 1, 10).items.map((item) => item.imageId), ["c", "b", "a"]);
  assert.deepEqual(queryImages(source, EMPTY_FILTER, "fileName", 1, 10).items.map((item) => item.imageId), ["a", "b", "c"]);
  assert.deepEqual(queryImages(source, EMPTY_FILTER, "byteSize", 1, 10).items.map((item) => item.imageId), ["c", "b", "a"]);
  assert.deepEqual(queryImages(source, EMPTY_FILTER, "dimensions", 1, 10).items.map((item) => item.imageId), ["a", "b", "c"]);
});

test("T70 groups by recent project, task, date or leaves results flat", () => {
  const records = [
    record({ imageId: "new", fileName: "new.png", generatedAt: "2026-07-31T10:00:00.000Z", projectId: "p1", projectName: "Zulu", taskId: "t1", taskName: "Batch one" }),
    record({ imageId: "old", fileName: "old.png", generatedAt: "2026-07-29T10:00:00.000Z", projectId: "p2", projectName: "Alpha", taskId: "t2", taskName: "Batch two" }),
    record({ imageId: "none", fileName: "none.png", generatedAt: "2026-07-28T10:00:00.000Z" })
  ];
  assert.deepEqual(groupImages(records, "recent_project")!.map((group) => group.key), ["p1", "p2", "unclassified"]);
  assert.deepEqual(groupImages(records, "project")!.map((group) => group.key), ["p2", "p1", "unclassified"]);
  assert.deepEqual(groupImages(records, "task")!.map((group) => group.key), ["t1", "t2", "unclassified"]);
  assert.deepEqual(groupImages(records, "date")!.map((group) => group.key), ["2026-07-31", "2026-07-29", "2026-07-28"]);
  assert.equal(groupImages(records, "none"), null);
  assert.deepEqual(queryImages(index(records), EMPTY_FILTER).groups?.map((group) => group.key), ["p1", "p2", "unclassified"]);
});

test("T71 paginates a large index without creating thumbnails during scan and creates one on demand", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-page-"));
  await sharp({ create: { width: 640, height: 320, channels: 3, background: "green" } }).png().toFile(join(root, "source.png"));
  const scanned = await scanImageIndex({ profileId: "profile-a", outputRoot: root });
  assert.equal(scanned.records[0]?.thumbnailPath, null);
  const thumbnailRoot = join(root, ".manager-thumbnails");
  const thumbnailPath = await createManagerThumbnail({ index: scanned, imageId: scanned.records[0]!.imageId, thumbnailRoot });
  const metadata = await sharp(thumbnailPath).metadata();
  assert.ok((metadata.width ?? 0) <= 320);
  assert.ok((metadata.height ?? 0) <= 320);

  const many = index(Array.from({ length: 55 }, (_, position) => record({
    imageId: String(position).padStart(2, "0"),
    fileName: `${position}.png`,
    generatedAt: new Date(Date.UTC(2026, 6, 30, 0, position)).toISOString()
  })));
  const page = queryImages(many, EMPTY_FILTER, "generatedAt_desc", 3, 20);
  assert.equal(page.total, 55);
  assert.equal(page.totalPages, 3);
  assert.equal(page.items.length, 15);
});

test("T65 persists an index atomically and rejects a mismatched Profile on read", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-store-"));
  const path = join(root, "image-index.json");
  const source = index([record({ imageId: "one", fileName: "one.png", generatedAt: "2026-07-30T00:00:00.000Z" })]);
  await writeImageIndex(path, source);
  assert.equal((await readImageIndex(path, "profile-a")).records.length, 1);
  await assert.rejects(() => readImageIndex(path, "profile-b"), /Profile/);
});

test("T72 returns safe details and exports without overwriting an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "gwi-export-"));
  const destination = join(root, "export");
  await mkdir(destination);
  const sourcePath = join(root, "source.png");
  await sharp({ create: { width: 16, height: 12, channels: 3, background: "white" } }).png().toFile(sourcePath);
  await utimes(sourcePath, new Date("2026-07-30T00:00:00.000Z"), new Date("2026-07-30T00:00:00.000Z"));
  const scanned = await scanImageIndex({ profileId: "profile-a", outputRoot: root });
  const imageId = scanned.records[0]!.imageId;
  const details = await getIndexedImageDetails(scanned, imageId);
  assert.equal(details.available, true);
  assert.equal(details.parentDirectory, dirname(await import("node:fs/promises").then(({ realpath }) => realpath(sourcePath))));
  assert.equal("delete" in details.actions, false);
  const exported = await exportIndexedImage(scanned, imageId, destination);
  assert.deepEqual(await readFile(exported), await readFile(sourcePath));
  await access(exported);
  await assert.rejects(() => exportIndexedImage(scanned, imageId, destination), /已存在/);
});

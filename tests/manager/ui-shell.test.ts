import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const shellFiles = [
  "src/manager/public/index.html",
  "src/manager/public/styles.css",
  "src/manager/public/app.js",
  "src/manager/public/mock-data.js",
  "src/manager/public/ui-contracts.js",
  "scripts/preview-manager.mjs"
];

test("T52 manager UI shell has a real previewable entry and scoped assets", () => {
  for (const path of shellFiles) {
    assert.equal(existsSync(path), true, `${path} must exist`);
  }

  const html = readFileSync("src/manager/public/index.html", "utf8");
  assert.match(html, /data-manager-shell/);
  assert.match(html, /manager\.css/);
  assert.match(html, /app\.js/);
  assert.doesNotMatch(html, /cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/);

  const css = readFileSync("src/manager/public/styles.css", "utf8");
  assert.match(css, /\[data-manager-shell\]/);

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.scripts?.["preview:manager"], "npm run build && node scripts/preview-manager.mjs");
});

test("T52/T56 shell replaces mock placeholders with the local manager API", () => {
  const source = [
    readFileSync("src/manager/public/app.js", "utf8"),
    readFileSync("src/manager/public/ui-contracts.js", "utf8")
  ].join("\n");

  assert.match(source, /fetch\s*\(/);
  assert.match(source, /\/api\/profiles/);
  assert.doesNotMatch(source, /mock-data\.js/);
  assert.doesNotMatch(source, /TODO\(codex-(?:connect|state|validate)\)/);
});

test("Profile manager UI separates activation from browser controls and uses the shared Toast", () => {
  const source = readFileSync("src/manager/public/app.js", "utf8");
  const contracts = readFileSync("src/manager/public/ui-contracts.js", "utf8");
  assert.match(source, /data-action=["']switch-profile["']/);
  assert.match(source, /manager-toast/);
  assert.match(source, /正在关闭/);
  assert.doesNotMatch(source, /当前启用 Profile[\\s\\S]{0,500}创建或导入 Profile/);
  assert.match(contracts, /closing/);
});

test("T52 shell preserves the four Stitch views and profile dialog", () => {
  const html = readFileSync("src/manager/public/index.html", "utf8");

  for (const id of ["view-overview", "view-migration", "view-security", "view-detail", "profile-modal"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must be preserved`);
  }

  assert.match(html, /switchView\(['"]overview['"]\)/);
  assert.match(html, /openModal\(\)/);
  assert.match(readFileSync("src/manager/public/app.js", "utf8"), /window\.switchView/);
});

test("T52 preserves the Stitch visual asset as a local source reference", () => {
  const html = readFileSync("src/manager/public/index.html", "utf8");
  assert.equal(existsSync("src/manager/public/assets/background.png"), true);
  assert.match(html, /assets\/background\.png/);
});

test("T52 tablet navigation keeps labels readable in the compact header", () => {
  const css = readFileSync("src/manager/public/styles.css", "utf8");
  const source = readFileSync("src/manager/public/app.js", "utf8");

  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1023px\)/);
  assert.match(
    css,
    /@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*?nav \.nav-link[\s\S]*?white-space:\s*nowrap/,
    "tablet navigation labels must not wrap vertically"
  );
  assert.match(
    css,
    /@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*?nav \.flex\.items-center\.space-x-4\s*>\s*button\.bg-mint-500[\s\S]*?font-size:\s*0/,
    "tablet refresh control must use a stable icon-only footprint"
  );
  assert.match(source, /class="lg:hidden space-y-3"/);
  assert.match(source, /class="hidden lg:block rounded-table-container/);
});

test("T62-T77 image UI preserves single-Profile request isolation and has no delete operation", () => {
  const source = readFileSync("src/manager/public/app.js", "utf8");
  assert.match(source, /AbortController/);
  assert.match(source, /imageRequestVersion/);
  assert.match(source, /\/images\/scan/);
  assert.match(source, /generatedAt_desc/);
  assert.match(source, /<button type="submit"[^>]*>应用筛选<\/button>/);
  assert.doesNotMatch(source, /method\s*:\s*["']DELETE["'][\s\S]{0,200}images/);
});

test("IMG-4 distinguishes an empty Profile from an empty filtered result", async () => {
  const contracts = await import(pathToFileURL(resolve("src/manager/public/ui-contracts.js")).href);

  assert.equal(contracts.imageEmptyStateMessage({}), "该 Profile 暂无图片");
  assert.equal(
    contracts.imageEmptyStateMessage({ sort: "generatedAt_desc", group: "recent_project" }),
    "该 Profile 暂无图片"
  );
  assert.equal(
    contracts.imageEmptyStateMessage({ keyword: "does-not-exist", sort: "generatedAt_desc" }),
    "没有符合当前筛选条件的图片"
  );
});

test("IMG-4 surfaces permission and scan issues instead of hiding them as an empty Profile", () => {
  const source = readFileSync("src/manager/public/app.js", "utf8");
  assert.match(source, /\/index-status/);
  assert.match(source, /PERMISSION_DENIED/);
  assert.match(source, /图片目录权限不足/);
});

import { managerContractVersion, membershipLabels, loginLabels, browserLabels, imageEmptyStateMessage } from "./ui-contracts.js";

const state = {
  profiles: [],
  activeProfileId: null,
  selectedProfileId: null,
  detailProfileId: null,
  directory: null,
  backups: [],
  images: { phase: "unselected", result: null, error: null, issues: [] },
  imageRequestVersion: 0,
  imageAbortController: null,
  imageFilters: {},
  imageView: "grid",
  currentView: "overview"
};

const shell = document.querySelector("[data-manager-shell]");
if (shell) shell.dataset.contractVersion = managerContractVersion;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(value) {
  if (value === null || value === undefined) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers ?? {}) };
  const response = await fetch(`/api${path}`, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({ error: { code: "INVALID_RESPONSE", message: "本地服务返回了无效响应" } }));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? "本地操作失败");
    error.code = payload?.error?.code ?? "REQUEST_FAILED";
    throw error;
  }
  return payload;
}

function notify(message, type = "info") {
  let region = document.getElementById("manager-notifications");
  if (!region) {
    region = document.createElement("div");
    region.id = "manager-notifications";
    region.className = "fixed right-4 top-20 z-[80] space-y-2 max-w-sm";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `rounded-lg border px-4 py-3 text-sm shadow-lg ${type === "error" ? "bg-red-50 border-red-200 text-red-800" : "bg-white border-gray-200 text-gray-700"}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 5000);
}

function profileById(profileId) { return state.profiles.find((profile) => profile.profileId === profileId) ?? null; }
function eligible(profile) { return profile.loginStatus === "logged_in" && ["plus", "pro", "go"].includes(profile.membership); }
const imageStatusLabels = { completed: "已完成", generating: "生成中", failed: "生成失败", missing: "文件缺失", corrupt: "文件损坏" };
const imageIssueLabels = {
  PERMISSION_DENIED: "图片目录权限不足，请检查目录权限后重新扫描。",
  FILE_MISSING: "发现索引中已不存在的图片文件。",
  FILE_CORRUPT: "发现无法解码的图片文件。",
  READ_FAILED: "发现无法读取的图片文件。",
  SYMLINK_IGNORED: "发现被安全规则忽略的符号链接。"
};

function imageStatusClass(status) {
  if (status === "completed") return "image-status-success";
  if (status === "generating") return "image-status-processing";
  return "image-status-error";
}

function imageIssueBanner(issues = []) {
  const labels = [...new Set(issues.map((issue) => imageIssueLabels[issue?.code]).filter(Boolean))];
  if (!labels.length) return "";
  return `<div role="status" class="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl px-4 py-3 text-sm"><i class="fa-solid fa-triangle-exclamation mr-2"></i><strong>图片目录检查：</strong>${labels.map(escapeHtml).join(" ")}</div>`;
}

function statusBadge(profile) {
  const login = loginLabels[profile.loginStatus] ?? "检测失败";
  const membership = membershipLabels[profile.membership] ?? "检测失败";
  const color = profile.loginStatus === "logged_in" ? "bg-green-50 text-green-700 border-green-200" : profile.loginStatus === "needs_login" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-100 text-gray-600 border-gray-200";
  return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs border ${color}">${escapeHtml(login)}</span><span class="inline-flex items-center px-2 py-1 rounded text-xs bg-blue-50 text-blue-700 border border-blue-100">${escapeHtml(membership)}</span>`;
}

function actionButton(action, profileId, label, icon, disabled = false, tone = "primary") {
  const styles = tone === "danger" ? "bg-red-50 text-red-700 border-red-200" : tone === "quiet" ? "bg-white text-gray-700 border-gray-200" : "bg-mint-600 text-white border-mint-600";
  return `<button type="button" data-action="${action}" data-profile-id="${escapeHtml(profileId)}" class="h-9 px-3 rounded-lg border text-sm font-medium ${styles} disabled:opacity-50 disabled:cursor-not-allowed" ${disabled ? "disabled" : ""}><i class="${icon} mr-1.5"></i>${escapeHtml(label)}</button>`;
}

function renderOverview() {
  const view = document.getElementById("view-overview");
  const active = profileById(state.activeProfileId);
  const loggedIn = state.profiles.filter((profile) => profile.loginStatus === "logged_in").length;
  const available = state.profiles.filter(eligible).length;
  const rows = state.profiles.map((profile) => `<tr class="border-t border-gray-100 hover:bg-mint-50/30" data-profile-row="${escapeHtml(profile.profileId)}">
    <td class="py-4"><button class="text-left" data-action="detail" data-profile-id="${escapeHtml(profile.profileId)}"><strong>${escapeHtml(profile.name)}</strong>${profile.active ? '<span class="ml-2 text-[10px] bg-mint-500 text-white px-1.5 py-0.5 rounded">当前启用</span>' : ""}<span class="block text-sm text-gray-500 mt-1">${escapeHtml(profile.accountLabel || profile.notes || "-")}</span></button></td>
    <td class="py-4"><div class="flex gap-2 flex-wrap">${statusBadge(profile)}</div></td>
    <td class="py-4 text-sm text-gray-600">${escapeHtml(browserLabels[profile.browserStatus] ?? "未知")}${profile.taskBusy ? '<span class="block text-xs text-amber-600">任务占用</span>' : ""}</td>
    <td class="py-4 text-sm text-gray-500">${escapeHtml(formatDate(profile.lastCheckedAt))}</td>
    <td class="py-4"><div class="flex justify-end gap-2 flex-wrap">${actionButton("activate", profile.profileId, profile.active ? "已启用" : "启用", "fa-solid fa-power-off", profile.active || profile.taskBusy, "quiet")}${actionButton(profile.browserStatus === "open" ? "close-browser" : "open-browser", profile.profileId, profile.browserStatus === "open" ? "关闭" : "打开浏览器", "fa-brands fa-chrome", profile.taskBusy, "primary")}${actionButton("check", profile.profileId, "检测", "fa-solid fa-rotate", profile.taskBusy, "quiet")}${actionButton("edit", profile.profileId, "编辑", "fa-solid fa-pen", false, "quiet")}</div></td>
  </tr>`).join("");
  const mobileCards = state.profiles.map((profile) => `<article class="bg-white border border-gray-100 rounded-xl p-4 shadow-soft" data-profile-row="${escapeHtml(profile.profileId)}"><button class="text-left w-full" data-action="detail" data-profile-id="${escapeHtml(profile.profileId)}"><strong>${escapeHtml(profile.name)}</strong>${profile.active ? '<span class="ml-2 text-[10px] bg-mint-500 text-white px-1.5 py-0.5 rounded">当前启用</span>' : ""}<span class="block text-sm text-gray-500 mt-1">${escapeHtml(profile.accountLabel || profile.notes || "-")}</span></button><div class="flex gap-2 flex-wrap mt-3">${statusBadge(profile)}</div><p class="text-sm text-gray-500 mt-3">Chrome：${escapeHtml(browserLabels[profile.browserStatus] ?? "未知")} · 检测：${escapeHtml(formatDate(profile.lastCheckedAt))}</p><div class="grid grid-cols-2 gap-2 mt-4">${actionButton("activate", profile.profileId, profile.active ? "已启用" : "启用", "fa-solid fa-power-off", profile.active || profile.taskBusy, "quiet")}${actionButton(profile.browserStatus === "open" ? "close-browser" : "open-browser", profile.profileId, profile.browserStatus === "open" ? "关闭" : "打开浏览器", "fa-brands fa-chrome", profile.taskBusy, "primary")}${actionButton("check", profile.profileId, "检测", "fa-solid fa-rotate", profile.taskBusy, "quiet")}${actionButton("edit", profile.profileId, "编辑", "fa-solid fa-pen", false, "quiet")}</div></article>`).join("");
  view.innerHTML = `<div id="overview-state" class="space-y-8">
    <section class="bg-gradient-to-r from-mint-50 to-mint-100 rounded-2xl p-6 shadow-soft border border-mint-200/50 flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
      <div><p class="text-sm text-gray-500 mb-1">当前启用 Profile</p><h1 class="text-2xl font-bold">${escapeHtml(active?.name ?? "尚未启用")}</h1><p class="text-sm text-gray-600 mt-2">${active ? `${escapeHtml(membershipLabels[active.membership])} · ${escapeHtml(loginLabels[active.loginStatus])} · ${escapeHtml(browserLabels[active.browserStatus])}` : "请选择已登录且具备 Plus、Pro 或 Go 会员的 Profile"}</p></div>
      <button type="button" data-action="create" class="h-10 px-5 bg-mint-600 text-white rounded-xl text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>创建或导入 Profile</button>
    </section>
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Profile 统计">
      ${[["Profile 总数", state.profiles.length], ["已登录", loggedIn], ["可启用", available], ["正在使用", state.profiles.filter((profile) => profile.browserStatus !== "closed" || profile.taskBusy).length]].map(([label, value]) => `<div class="bg-white rounded-2xl p-5 shadow-soft"><p class="text-sm text-gray-500">${label}</p><strong class="text-3xl block mt-1">${value}</strong></div>`).join("")}
    </section>
    <section><div class="flex justify-between items-center mb-4"><h2 class="text-xl font-bold">Profile 列表</h2><button type="button" data-action="create" class="h-10 px-5 bg-mint-600 text-white rounded-xl text-sm font-semibold"><i class="fa-solid fa-plus mr-2"></i>创建 Profile</button></div>
      <div class="md:hidden space-y-3">${mobileCards || '<p class="py-12 text-center text-gray-500">尚无 Profile，请先创建或导入。</p>'}</div><div class="hidden md:block rounded-table-container shadow-soft overflow-x-auto"><table class="w-full min-w-[900px] text-left"><thead><tr class="bg-gray-50 text-xs text-gray-500"><th class="py-4">Profile 信息</th><th>账号状态</th><th>Chrome 状态</th><th>最后检测</th><th class="text-right">操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="py-14 text-center text-gray-500">尚无 Profile，请先创建或导入。</td></tr>'}</tbody></table></div>
    </section>
  </div>`;
}

function renderMigration() {
  const view = document.getElementById("view-migration");
  const directory = state.directory;
  view.innerHTML = `<div class="max-w-5xl mx-auto space-y-6"><header><h1 class="text-3xl font-bold">默认目录与迁移</h1><p class="text-gray-500 mt-2">管理新建 Profile 的默认位置，并安全迁移或保留现有目录。</p></header>
    <section class="bg-white border border-gray-100 rounded-2xl p-6 shadow-soft space-y-5"><div><p class="text-sm text-gray-500">当前默认目录</p><code class="block mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 break-all">${escapeHtml(directory?.defaultRootDir ?? "正在读取...")}</code></div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm"><div><span class="text-gray-500">Profile 数量</span><strong class="block text-2xl">${directory?.profileCount ?? state.profiles.length}</strong></div><div><span class="text-gray-500">历史保留目录</span><strong class="block text-2xl">${directory?.retainedRoots?.length ?? 0}</strong></div><div><span class="text-gray-500">最近扫描</span><strong class="block mt-1">${escapeHtml(formatDate(directory?.scannedAt))}</strong></div></div>
    </section>
    <form id="directory-form" class="bg-white border border-gray-100 rounded-2xl p-6 shadow-soft space-y-5"><div><label class="text-sm font-semibold" for="directory-target">新的默认目录</label><input id="directory-target" name="targetRootDir" required class="mt-2 w-full h-11 px-4 border border-gray-200 rounded-lg" placeholder="请输入本机绝对路径"/></div>
      <fieldset><legend class="text-sm font-semibold mb-3">处理方式</legend><div class="grid sm:grid-cols-2 gap-3"><label class="border border-gray-200 rounded-xl p-4"><input type="radio" name="mode" value="migrate" checked class="mr-2"/><strong>迁移</strong><span class="block text-sm text-gray-500 mt-1">复制并校验全部 Profile 后切换，源数据继续保留。</span></label><label class="border border-gray-200 rounded-xl p-4"><input type="radio" name="mode" value="retain" class="mr-2"/><strong>保留</strong><span class="block text-sm text-gray-500 mt-1">旧 Profile 保持原位，仅更改以后新建位置。</span></label></div></fieldset>
      <div id="directory-plan" class="hidden rounded-lg border p-4 text-sm"></div><div class="flex justify-end gap-3"><button type="button" data-action="plan-directory" class="h-10 px-5 border border-gray-200 rounded-full">执行预检</button><button type="submit" class="h-10 px-6 bg-mint-600 text-white rounded-full font-semibold">确认执行</button></div></form>
  </div>`;
}

function renderSecurity() {
  const view = document.getElementById("view-security");
  const options = state.profiles.map((profile) => `<option value="${escapeHtml(profile.profileId)}">${escapeHtml(profile.name)}</option>`).join("");
  const backups = state.backups.map((backup) => `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-4 border-t border-gray-100"><div><strong>${escapeHtml(backup.sourceProfileName || backup.sourceProfileId)}</strong><span class="block text-xs text-gray-500 mt-1">${escapeHtml(formatDate(backup.createdAt))} · ${escapeHtml(formatBytes(backup.byteSize))}</span></div><button type="button" data-action="restore-backup" data-backup-id="${escapeHtml(backup.backupId)}" class="h-9 px-4 border border-mint-200 text-mint-700 rounded-lg">恢复为新 Profile</button></div>`).join("");
  view.innerHTML = `<div class="max-w-5xl mx-auto space-y-6"><header><h1 class="text-3xl font-bold">安全与备份</h1><p class="text-gray-500 mt-2">创建整个专用 Profile 的本地副本。</p></header>
    <section class="bg-white border border-gray-100 rounded-2xl p-6 shadow-soft space-y-5"><div class="bg-amber-50 border border-amber-200 p-4 rounded-xl text-sm text-amber-900"><i class="fa-solid fa-triangle-exclamation mr-2"></i><strong>敏感数据警告：</strong>备份未加密，并包含 Chrome 登录数据，请只保存在可信本机位置。</div>
      <div class="flex flex-col sm:flex-row gap-3"><label class="sr-only" for="backup-profile">选择 Profile</label><select id="backup-profile" class="h-10 px-4 border border-gray-200 rounded-lg flex-1"><option value="">选择需要备份的 Profile</option>${options}</select><button type="button" data-action="create-backup" class="h-10 px-5 bg-mint-600 text-white rounded-lg font-semibold"><i class="fa-solid fa-box-archive mr-2"></i>创建完整备份</button></div>
      <div class="border border-gray-100 rounded-xl"><div class="px-4 py-3 bg-gray-50 text-xs font-semibold text-gray-500">可用备份</div>${backups || '<p class="px-4 py-10 text-center text-gray-500">尚无备份</p>'}</div>
    </section></div>`;
}

function imageState(message, icon = "fa-regular fa-image", error = false) {
  return `<div class="col-span-full py-16 text-center ${error ? "text-red-600" : "text-gray-500"}"><i class="${icon} text-3xl mb-3"></i><strong class="block">${escapeHtml(message)}</strong></div>`;
}

function renderImages() {
  const view = document.getElementById("view-images");
  const profileOptions = state.profiles.map((profile) => `<option value="${escapeHtml(profile.profileId)}" ${state.selectedProfileId === profile.profileId ? "selected" : ""}>${escapeHtml(profile.name)}${profile.active ? "（当前启用）" : ""}</option>`).join("");
  const result = state.images.result;
  const issueBanner = imageIssueBanner(state.images.issues);
  const records = result?.items ?? [];
  let content = "";
  if (!state.selectedProfileId) content = imageState("请先选择 Profile，选择前不会查询图片。", "fa-regular fa-id-badge");
  else if (state.images.phase === "loading" || state.images.phase === "scanning") content = imageState(state.images.phase === "scanning" ? "正在扫描图片目录..." : "正在读取图片索引...", "fa-solid fa-spinner fa-spin");
  else if (state.images.phase === "error") content = imageState(state.images.error ?? "图片读取失败", "fa-solid fa-folder-open", true);
  else if (!records.length) content = imageState(imageEmptyStateMessage(state.imageFilters));
  else content = records.map((image) => `<article class="group bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-soft cursor-pointer" data-action="image-detail" data-image-id="${escapeHtml(image.imageId)}"><div class="aspect-square bg-gray-100 relative overflow-hidden">${image.status === "completed" ? `<img loading="lazy" class="w-full h-full object-cover" src="/api/profiles/${encodeURIComponent(image.profileId)}/images/${encodeURIComponent(image.imageId)}/content?kind=thumbnail" alt="${escapeHtml(image.fileName)}"/>` : `<div class="h-full flex flex-col gap-3 items-center justify-center text-gray-500"><i class="fa-solid ${image.status === "generating" ? "fa-spinner fa-spin text-mint-600" : image.status === "failed" ? "fa-circle-xmark text-red-500" : "fa-file-circle-exclamation text-amber-500"} text-3xl"></i><span class="text-sm font-medium">${escapeHtml(imageStatusLabels[image.status] ?? image.status)}</span></div>`}<span class="absolute top-2 right-2 image-status ${imageStatusClass(image.status)}">${escapeHtml(imageStatusLabels[image.status] ?? image.status)}</span></div><div class="p-3"><strong class="text-sm block truncate">${escapeHtml(image.fileName)}</strong><p class="text-xs text-mint-700 mt-1 truncate">${escapeHtml(image.projectName || "未归类")} · ${escapeHtml(image.taskName || image.taskId || "无任务")}</p><div class="flex justify-between text-xs text-gray-500 mt-3"><span>${escapeHtml(formatDate(image.generatedAt))}</span><span>${image.width && image.height ? `${image.width}×${image.height}` : "-"}</span></div></div></article>`).join("");
  const projectCount = new Set(records.map((image) => image.projectId).filter(Boolean)).size;
  view.innerHTML = `<div class="image-manager max-w-7xl mx-auto space-y-6"><header class="flex flex-col md:flex-row md:items-end justify-between gap-4"><div><h1 class="text-3xl font-bold">图片管理</h1><p class="text-gray-500 mt-2">选择一个 Profile 查看其本地图片。</p></div><select id="image-profile-select" class="w-full md:w-80 h-10 px-4 border border-gray-200 rounded-lg"><option value="">请选择 Profile</option>${profileOptions}</select></header>
    ${issueBanner}
    <section class="grid grid-cols-1 md:grid-cols-3 gap-4"><div class="bg-white p-4 rounded-2xl shadow-soft"><span class="text-xs text-gray-500">图片总数</span><strong class="block text-2xl">${result?.total ?? 0}</strong></div><div class="bg-white p-4 rounded-2xl shadow-soft"><span class="text-xs text-gray-500">当前页</span><strong class="block text-2xl">${records.length}</strong></div><div class="bg-white p-4 rounded-2xl shadow-soft"><span class="text-xs text-gray-500">项目数量</span><strong class="block text-2xl">${projectCount}</strong></div></section>
    <form id="image-filter-form" class="bg-white p-4 rounded-2xl shadow-soft grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3"><input name="keyword" type="search" class="h-10 px-3 border border-gray-200 rounded-lg lg:col-span-2" placeholder="搜索文件、项目或任务"/><select name="status" class="h-10 px-3 border border-gray-200 rounded-lg"><option value="">全部状态</option><option value="completed">成功</option><option value="generating">生成中</option><option value="failed">失败</option><option value="missing">缺失</option><option value="corrupt">损坏</option></select><select name="format" class="h-10 px-3 border border-gray-200 rounded-lg"><option value="">全部格式</option><option>png</option><option>jpg</option><option>webp</option><option>gif</option></select><select name="orientation" class="h-10 px-3 border border-gray-200 rounded-lg"><option value="">全部方向</option><option value="landscape">横向</option><option value="portrait">纵向</option><option value="square">方形</option></select><select name="sort" class="h-10 px-3 border border-gray-200 rounded-lg"><option value="generatedAt_desc">时间：新到旧</option><option value="generatedAt_asc">时间：旧到新</option><option value="projectActivity">最近项目</option><option value="fileName">文件名</option><option value="byteSize">文件大小</option><option value="dimensions">尺寸</option></select><select name="group" class="h-10 px-3 border border-gray-200 rounded-lg"><option value="recent_project">最近项目分组</option><option value="project">项目分组</option><option value="task">任务分组</option><option value="date">日期分组</option><option value="none">不分组</option></select><button type="submit" class="h-10 px-4 bg-mint-600 text-white rounded-lg font-semibold">应用筛选</button><button type="button" data-action="scan-images" class="h-10 px-4 border border-gray-200 rounded-lg"><i class="fa-solid fa-rotate mr-2"></i>重新扫描</button><div class="flex gap-1"><button type="button" data-action="image-grid" title="网格视图" class="w-10 h-10 border border-gray-200 rounded-lg"><i class="fa-solid fa-grip"></i></button><button type="button" data-action="image-list" title="列表视图" class="w-10 h-10 border border-gray-200 rounded-lg"><i class="fa-solid fa-list"></i></button></div><details class="sm:col-span-2 lg:col-span-6 border-t border-gray-100 pt-3"><summary class="text-sm font-medium cursor-pointer">更多筛选</summary><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3"><input name="projectId" class="h-10 px-3 border border-gray-200 rounded-lg" placeholder="项目 ID"/><input name="taskId" class="h-10 px-3 border border-gray-200 rounded-lg" placeholder="任务 ID"/><select name="generationType" class="h-10 px-3 border border-gray-200 rounded-lg"><option value="">全部生成类型</option><option value="text_to_image">文字生图</option><option value="image_to_image">参考图改图</option><option value="refine">连续修改</option><option value="other">其他</option></select><span></span><label class="text-xs text-gray-500">开始时间<input name="from" type="date" class="mt-1 w-full h-10 px-3 border border-gray-200 rounded-lg"/></label><label class="text-xs text-gray-500">结束时间<input name="to" type="date" class="mt-1 w-full h-10 px-3 border border-gray-200 rounded-lg"/></label><input name="minWidth" type="number" min="0" class="h-10 px-3 border border-gray-200 rounded-lg self-end" placeholder="最小宽度"/><input name="minHeight" type="number" min="0" class="h-10 px-3 border border-gray-200 rounded-lg self-end" placeholder="最小高度"/></div></details></form>
    <section class="${state.imageView === "list" ? "grid grid-cols-1" : "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4"} gap-5" id="image-results">${content}</section>
    ${result?.totalPages > 1 ? `<nav class="flex justify-center items-center gap-3"><button data-action="image-page" data-page="${Math.max(1, result.page - 1)}" class="w-10 h-10 border rounded-lg" ${result.page <= 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button><span class="text-sm">${result.page} / ${result.totalPages}</span><button data-action="image-page" data-page="${Math.min(result.totalPages, result.page + 1)}" class="w-10 h-10 border rounded-lg" ${result.page >= result.totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button></nav>` : ""}
  </div>`;
  const filterForm = document.getElementById("image-filter-form");
  if (filterForm) for (const [name, value] of Object.entries(state.imageFilters)) { const control = filterForm.elements.namedItem(name); if (control && "value" in control) control.value = value; }
}

function renderDetail() {
  const view = document.getElementById("view-detail");
  const profile = profileById(state.detailProfileId);
  if (!profile) { view.innerHTML = imageState("Profile 不存在", "fa-regular fa-circle-xmark", true); return; }
  view.innerHTML = `<div class="max-w-6xl mx-auto space-y-6"><button type="button" data-action="back-overview" class="text-sm text-gray-600"><i class="fa-solid fa-arrow-left mr-2"></i>返回总览</button><header><div class="flex flex-wrap items-center gap-3"><h1 class="text-3xl font-bold">${escapeHtml(profile.name)}</h1>${profile.active ? '<span class="px-3 py-1 bg-mint-100 text-mint-700 rounded-full text-xs">当前启用</span>' : ""}</div><code class="block mt-3 bg-mint-50 border border-mint-100 px-4 py-2 rounded-lg break-all">${escapeHtml(profile.profileDir)}</code></header>
    <div class="flex flex-wrap gap-3">${actionButton(profile.browserStatus === "open" ? "close-browser" : "open-browser", profile.profileId, profile.browserStatus === "open" ? "关闭浏览器" : "打开浏览器", "fa-brands fa-chrome")}${actionButton("check", profile.profileId, "重新检测", "fa-solid fa-rotate", false, "quiet")}${actionButton("backup-profile", profile.profileId, "创建独立备份", "fa-solid fa-box-archive", false, "quiet")}${actionButton("edit", profile.profileId, "编辑", "fa-solid fa-pen", false, "quiet")}</div>
    <section class="grid md:grid-cols-3 gap-5">${[["账号状态", `${loginLabels[profile.loginStatus]} · ${membershipLabels[profile.membership]}`], ["浏览器状态", `${browserLabels[profile.browserStatus]}${profile.taskBusy ? " · 任务占用" : ""}`], ["时间信息", `创建 ${formatDate(profile.createdAt)} · 检测 ${formatDate(profile.lastCheckedAt)}`]].map(([title, value]) => `<div class="bg-white border border-gray-100 rounded-2xl p-6 shadow-soft"><h2 class="text-sm text-mint-700 font-semibold">${escapeHtml(title)}</h2><p class="mt-4 text-gray-800">${escapeHtml(value)}</p></div>`).join("")}</section>
    <section class="border border-red-200 bg-red-50 rounded-2xl p-6 flex flex-col sm:flex-row justify-between gap-4"><div><h2 class="font-bold text-red-700">删除整个 Profile 和 Chrome 数据</h2><p class="text-sm text-red-700 mt-2">此操作不可恢复，只能在本页面完成两次确认。</p></div>${actionButton("delete-profile", profile.profileId, "删除 Profile", "fa-regular fa-trash-can", profile.active || profile.taskBusy || profile.browserStatus !== "closed", "danger")}</section>
  </div>`;
}

function renderAll() {
  renderOverview(); renderMigration(); renderSecurity(); renderImages(); renderDetail();
  document.getElementById("profile-attention-dot")?.classList.toggle("hidden", state.profiles.every(eligible));
}

function setView(viewId) {
  state.currentView = viewId;
  document.querySelectorAll(".view-section").forEach((element) => element.classList.toggle("active", element.id === `view-${viewId}`));
  for (const id of ["overview", "migration", "security", "images"]) {
    const nav = document.getElementById(`nav-${id}`);
    if (!nav) continue;
    const active = id === viewId || (id === "overview" && viewId === "detail");
    nav.classList.toggle("active", active);
    nav.classList.toggle("inactive", !active);
  }
  if (viewId === "images") renderImages();
  document.querySelectorAll('[data-action="nav-view"]').forEach((button) => button.classList.toggle("text-mint-600", button.dataset.view === viewId || (button.dataset.view === "overview" && viewId === "detail")));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

window.switchView = setView;
window.openModal = () => openProfileModal();
window.closeModal = () => closeProfileModal();
window.openImageModal = () => undefined;
window.closeImageModal = closeImageModal;

function closeProfileModal() { document.getElementById("profile-modal")?.classList.remove("active"); document.body.style.overflow = ""; }

function openProfileModal(profileId = null) {
  const profile = profileId ? profileById(profileId) : null;
  const modal = document.getElementById("profile-modal");
  modal.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden modal-content"><form id="profile-form"><div class="px-6 py-4 border-b flex justify-between"><h2 class="font-bold">${profile ? "编辑 Profile" : "创建或导入 Profile"}</h2><button type="button" data-action="close-profile-modal" title="关闭" class="w-8 h-8"><i class="fa-solid fa-xmark"></i></button></div><div class="p-6 space-y-4"><div class="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-800">禁止导入日常 Chrome Profile。系统只接受本项目归属标记有效的专用目录。</div><input type="hidden" name="profileId" value="${escapeHtml(profile?.profileId ?? "")}"/><label class="block text-sm font-semibold">Profile 名称<input required name="name" maxlength="80" value="${escapeHtml(profile?.name ?? "")}" class="mt-1 w-full h-10 px-3 border border-gray-200 rounded-lg"/></label><label class="block text-sm font-semibold">账号备注<input name="accountLabel" value="${escapeHtml(profile?.accountLabel ?? "")}" class="mt-1 w-full h-10 px-3 border border-gray-200 rounded-lg"/></label><label class="block text-sm font-semibold">普通备注<textarea name="notes" class="mt-1 w-full min-h-20 px-3 py-2 border border-gray-200 rounded-lg">${escapeHtml(profile?.notes ?? "")}</textarea></label>${profile ? "" : '<fieldset class="space-y-2"><label class="block"><input type="radio" name="mode" value="create" checked class="mr-2"/>创建新的专用 Profile</label><label class="block"><input type="radio" name="mode" value="import" class="mr-2"/>导入已有专用 Profile</label></fieldset><label class="block text-sm font-semibold">导入目录（仅导入时）<input name="profileDir" class="mt-1 w-full h-10 px-3 border border-gray-200 rounded-lg" placeholder="本机绝对路径"/></label>'}</div><div class="p-6 border-t flex justify-end gap-3"><button type="button" data-action="close-profile-modal" class="h-10 px-5 border rounded-full">取消</button><button name="openAfterSave" value="true" class="h-10 px-5 border border-mint-200 text-mint-700 rounded-full">保存并打开</button><button class="h-10 px-6 bg-mint-600 text-white rounded-full">保存</button></div></form></div>`;
  modal.classList.add("active");
  document.body.style.overflow = "hidden";
}

function closeImageModal() { document.getElementById("image-detail-modal")?.classList.remove("active"); document.body.style.overflow = ""; }

async function openImageDetails(imageId) {
  const profileId = state.selectedProfileId;
  if (!profileId) return;
  try {
    const details = await api(`/profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}`);
    const image = details.record;
    const modal = document.getElementById("image-detail-modal");
    const preview = details.actions.preview
      ? `<img class="max-w-full max-h-full object-contain p-4" src="/api/profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}/content" alt="${escapeHtml(image.fileName)}"/>`
      : `<div class="text-center text-gray-500 p-8"><i class="fa-solid ${image.status === "generating" ? "fa-spinner fa-spin text-mint-600" : "fa-circle-exclamation text-amber-500"} text-4xl"></i><strong class="block mt-4">${escapeHtml(imageStatusLabels[image.status] ?? image.status)}</strong><p class="mt-2 text-sm">${escapeHtml(image.note || "当前没有可预览的图片文件")}</p></div>`;
    const actions = [
      details.actions.openDirectory ? `<button data-action="open-image-directory" data-image-id="${escapeHtml(imageId)}" class="h-10 bg-mint-600 text-white rounded-lg"><i class="fa-solid fa-folder-open mr-2"></i>在文件夹中显示</button>` : "",
      details.actions.copyPath ? `<button data-action="copy-image-path" data-path="${escapeHtml(image.absolutePath)}" class="h-10 border rounded-lg"><i class="fa-regular fa-copy mr-2"></i>复制路径</button>` : "",
      details.actions.export ? `<a class="h-10 border rounded-lg flex items-center justify-center" href="/api/profiles/${encodeURIComponent(profileId)}/images/${encodeURIComponent(imageId)}/content?download=1"><i class="fa-solid fa-download mr-2"></i>导出图片</a>` : ""
    ].join("");
    modal.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden modal-content flex flex-col md:flex-row h-[85vh]"><div class="flex-1 bg-gray-50 flex items-center justify-center min-h-56">${preview}</div><aside class="w-full md:w-[400px] p-6 overflow-y-auto"><div class="flex justify-between"><h2 class="font-bold">图片详情</h2><button data-action="close-image-modal" title="关闭" class="w-8 h-8"><i class="fa-solid fa-xmark"></i></button></div><h3 class="mt-6 font-mono text-sm break-all">${escapeHtml(image.fileName)}</h3><span class="inline-flex mt-3 image-status ${imageStatusClass(image.status)}">${escapeHtml(imageStatusLabels[image.status] ?? image.status)}</span><dl class="mt-5 space-y-3 text-sm"><div><dt class="text-gray-500">项目 / 任务</dt><dd>${escapeHtml(image.projectName || "未归类")} / ${escapeHtml(image.taskName || image.taskId || "-")}</dd></div><div><dt class="text-gray-500">尺寸与格式</dt><dd>${image.width ?? "-"} × ${image.height ?? "-"} · ${escapeHtml(image.format ? image.format.toUpperCase() : "-")} · ${escapeHtml(formatBytes(image.byteSize))}</dd></div><div><dt class="text-gray-500">生成时间</dt><dd>${escapeHtml(formatDate(image.generatedAt))}</dd></div>${details.actions.copyPath ? `<div><dt class="text-gray-500">本地路径</dt><dd class="break-all">${escapeHtml(image.absolutePath)}</dd></div>` : ""}</dl>${actions ? `<div class="mt-8 grid gap-2">${actions}</div>` : ""}</aside></div>`;
    modal.classList.add("active");
    document.body.style.overflow = "hidden";
  } catch (error) { notify(error.message, "error"); }
}

function imageQuery(page = 1) {
  const form = document.getElementById("image-filter-form");
  if (form) state.imageFilters = Object.fromEntries(new FormData(form));
  const data = state.imageFilters;
  const query = new URLSearchParams({ page: String(page), pageSize: "40", sort: String(data.sort || "generatedAt_desc"), group: String(data.group || "recent_project") });
  for (const field of ["keyword", "status", "format", "orientation", "projectId", "taskId", "generationType", "from", "to", "minWidth", "minHeight"]) { const value = data[field]; if (value) query.set(field, field === "from" ? `${value}T00:00:00.000` : field === "to" ? `${value}T23:59:59.999` : String(value)); }
  return query;
}

async function loadImages(page = 1) {
  const profileId = state.selectedProfileId;
  const query = imageQuery(page);
  state.imageRequestVersion += 1;
  const version = state.imageRequestVersion;
  state.imageAbortController?.abort();
  state.imageAbortController = new AbortController();
  if (!profileId) { state.images = { phase: "unselected", result: null, error: null, issues: [] }; renderImages(); return; }
  state.images = { phase: "loading", result: null, error: null, issues: [] }; renderImages();
  try {
    const [result, indexStatus] = await Promise.all([
      api(`/profiles/${encodeURIComponent(profileId)}/images?${query}`, { signal: state.imageAbortController.signal }),
      api(`/profiles/${encodeURIComponent(profileId)}/images/index-status`, { signal: state.imageAbortController.signal })
    ]);
    if (version !== state.imageRequestVersion || profileId !== state.selectedProfileId) return;
    state.images = { phase: "ready", result, error: null, issues: Array.isArray(indexStatus?.issues) ? indexStatus.issues : [] };
  } catch (error) {
    if (error.name === "AbortError" || version !== state.imageRequestVersion) return;
    state.images = { phase: "error", result: null, error: error.message, issues: [] };
  }
  renderImages();
}

async function refreshAll(showMessage = false) {
  try {
    const [profiles, directory, backups] = await Promise.all([api("/profiles"), api("/directories"), api("/backups")]);
    state.profiles = profiles.profiles;
    state.activeProfileId = profiles.activeProfileId;
    state.directory = directory;
    state.backups = backups.backups;
    if (state.selectedProfileId && !profileById(state.selectedProfileId)) state.selectedProfileId = null;
    if (state.detailProfileId && !profileById(state.detailProfileId)) state.detailProfileId = null;
    renderAll();
    if (state.selectedProfileId) await loadImages();
    if (showMessage) notify("本地状态已刷新并完成目录扫描");
  } catch (error) {
    renderAll();
    notify(error.message, "error");
  }
}

document.addEventListener("change", (event) => {
  if (event.target.id === "image-profile-select") {
    state.selectedProfileId = event.target.value || null;
    state.imageFilters = {};
    state.images = { phase: state.selectedProfileId ? "loading" : "unselected", result: null, error: null, issues: [] };
    loadImages();
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id === "profile-form") {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const submitter = event.submitter;
    try {
      let profile;
      if (data.profileId) profile = await api(`/profiles/${encodeURIComponent(data.profileId)}`, { method: "PATCH", body: JSON.stringify({ name: data.name, accountLabel: data.accountLabel || null, notes: data.notes || null }) });
      else if (data.mode === "import") profile = await api("/profiles/import", { method: "POST", body: JSON.stringify({ name: data.name, accountLabel: data.accountLabel || null, notes: data.notes || null, profileDir: data.profileDir }) });
      else profile = await api("/profiles", { method: "POST", body: JSON.stringify({ name: data.name, accountLabel: data.accountLabel || null, notes: data.notes || null }) });
      closeProfileModal();
      await refreshAll();
      if (submitter?.name === "openAfterSave") await performProfileAction("open-browser", profile.profileId);
    } catch (error) { notify(error.message, "error"); }
  }
  if (event.target.id === "directory-form") {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    if (!window.confirm(`确认以“${data.mode === "migrate" ? "迁移" : "保留"}”方式切换默认目录？`)) return;
    try { await api(`/directories/${data.mode}`, { method: "POST", body: JSON.stringify({ targetRootDir: data.targetRootDir }) }); await refreshAll(); notify("默认目录已更新"); }
    catch (error) { notify(error.message, "error"); }
  }
  if (event.target.id === "image-filter-form") { event.preventDefault(); loadImages(); }
});

async function performProfileAction(action, profileId) {
  try {
    if (action === "detail") { state.detailProfileId = profileId; renderDetail(); setView("detail"); return; }
    if (action === "edit") { openProfileModal(profileId); return; }
    if (action === "activate") await api(`/profiles/${encodeURIComponent(profileId)}/activate`, { method: "POST" });
    if (action === "check") await api(`/profiles/${encodeURIComponent(profileId)}/check`, { method: "POST" });
    if (action === "open-browser") await api(`/profiles/${encodeURIComponent(profileId)}/open`, { method: "POST" });
    if (action === "close-browser") await api(`/profiles/${encodeURIComponent(profileId)}/close`, { method: "POST" });
    if (action === "backup-profile") { await api(`/profiles/${encodeURIComponent(profileId)}/backups`, { method: "POST" }); notify("完整备份已创建"); }
    await refreshAll();
  } catch (error) { notify(error.message, "error"); }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const profileId = button.dataset.profileId;
  if (["detail", "edit", "activate", "check", "open-browser", "close-browser", "backup-profile"].includes(action)) return performProfileAction(action, profileId);
  if (action === "create") return openProfileModal();
  if (action === "close-profile-modal") return closeProfileModal();
  if (action === "back-overview") return setView("overview");
  if (action === "nav-view") return setView(button.dataset.view);
  if (action === "refresh") return refreshAll(true);
  if (action === "show-notifications") {
    const attention = state.profiles.filter((profile) => !eligible(profile));
    return notify(attention.length ? `${attention.length} 个 Profile 尚未通过登录和会员资格检查` : "当前没有需要处理的 Profile 状态");
  }
  if (action === "open-active-profile") {
    if (!state.activeProfileId) return notify("尚未启用 Profile，请先在总览中选择合格账号");
    return performProfileAction("detail", state.activeProfileId);
  }
  if (action === "create-backup") {
    const selected = document.getElementById("backup-profile")?.value;
    if (!selected) return notify("请先选择需要备份的 Profile", "error");
    return performProfileAction("backup-profile", selected);
  }
  if (action === "restore-backup") {
    const name = window.prompt("请输入恢复后新 Profile 的名称");
    if (!name) return;
    try { await api(`/backups/${encodeURIComponent(button.dataset.backupId)}/restore`, { method: "POST", body: JSON.stringify({ name }) }); await refreshAll(); notify("备份已恢复为新的未启用 Profile"); } catch (error) { notify(error.message, "error"); }
  }
  if (action === "plan-directory") {
    const form = document.getElementById("directory-form");
    const data = Object.fromEntries(new FormData(form));
    try { const plan = await api("/directories/plan", { method: "POST", body: JSON.stringify(data) }); const target = document.getElementById("directory-plan"); target.classList.remove("hidden"); target.textContent = `预检完成：${plan.profileCount} 个 Profile；冲突 ${plan.conflicts.length}；占用 ${plan.busyProfileIds.length}`; } catch (error) { notify(error.message, "error"); }
  }
  if (action === "delete-profile") {
    const profile = profileById(profileId);
    if (!profile || !window.confirm(`第一次确认：删除 ${profile.name} 及全部 Chrome 数据？`)) return;
    const typed = window.prompt(`第二次确认：请输入 Profile 名称“${profile.name}”`);
    if (typed !== profile.name) return notify("名称不匹配，删除已取消", "error");
    try { const issued = await api(`/profiles/${encodeURIComponent(profileId)}/delete-confirmation`, { method: "POST", body: JSON.stringify({ profileName: typed }) }); await api(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE", headers: { "X-Delete-Confirmation": issued.confirmation } }); state.detailProfileId = null; setView("overview"); await refreshAll(); notify("Profile 已删除"); } catch (error) { notify(error.message, "error"); }
  }
  if (action === "scan-images") {
    if (!state.selectedProfileId) return;
    state.images = { phase: "scanning", result: null, error: null, issues: [] }; renderImages();
    try { await api(`/profiles/${encodeURIComponent(state.selectedProfileId)}/images/scan`, { method: "POST" }); await loadImages(); } catch (error) { state.images = { phase: "error", result: null, error: error.message, issues: [] }; renderImages(); }
  }
  if (action === "image-detail") return openImageDetails(button.dataset.imageId);
  if (action === "close-image-modal") return closeImageModal();
  if (action === "copy-image-path") { await navigator.clipboard.writeText(button.dataset.path); notify("图片路径已复制"); }
  if (action === "open-image-directory") { try { await api(`/profiles/${encodeURIComponent(state.selectedProfileId)}/images/${encodeURIComponent(button.dataset.imageId)}/open-directory`, { method: "POST" }); } catch (error) { notify(error.message, "error"); } }
  if (action === "image-grid" || action === "image-list") { state.imageView = action === "image-grid" ? "grid" : "list"; renderImages(); }
  if (action === "image-page") loadImages(Number(button.dataset.page));
});

const mobileNavigation = document.createElement("nav");
mobileNavigation.className = "md:hidden fixed bottom-0 left-0 right-0 z-50 h-16 bg-white border-t border-gray-200 grid grid-cols-4 shadow-lg";
mobileNavigation.setAttribute("aria-label", "移动端页面导航");
mobileNavigation.innerHTML = [["overview", "fa-border-all", "Profile"], ["migration", "fa-folder-open", "目录"], ["security", "fa-shield-halved", "备份"], ["images", "fa-image", "图片"]].map(([view, icon, label]) => `<button type="button" data-action="nav-view" data-view="${view}" class="flex flex-col items-center justify-center text-xs text-gray-600"><i class="fa-solid ${icon} mb-1"></i>${label}</button>`).join("");
document.body.append(mobileNavigation);
setView(state.currentView);

renderAll();
shell?.removeAttribute("data-runtime-pending");
refreshAll();

export const managerContractVersion = "manager-api-v1";

export const loginLabels = Object.freeze({
  checking: "检测中",
  logged_in: "已登录",
  needs_login: "未登录",
  verification_required: "需要人工验证",
  technical_failure: "检测失败"
});

export const membershipLabels = Object.freeze({ plus: "Plus", pro: "Pro", go: "Go", other: "不符合资格", technical_failure: "检测失败" });
export const browserLabels = Object.freeze({ closed: "未运行", open: "运行中", task_busy: "任务运行中", unknown: "状态未知" });

const imageFilterFields = Object.freeze([
  "keyword", "status", "format", "orientation", "projectId", "taskId",
  "generationType", "from", "to", "minWidth", "minHeight"
]);

export function imageEmptyStateMessage(filters = {}) {
  const hasActiveFilter = imageFilterFields.some((field) => String(filters[field] ?? "").trim() !== "");
  return hasActiveFilter ? "没有符合当前筛选条件的图片" : "该 Profile 暂无图片";
}

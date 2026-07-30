import type { RequestKind } from "./parse-request.js";

export interface SubmissionInput {
  kind: RequestKind;
  prompt: string;
  sourceResultIds?: string[];
  modifyAll?: boolean;
  count?: number;
  targetCount?: number;
}

export interface SubmissionAssessment {
  executable: boolean;
  question?: string;
  candidates?: string[];
  reason?: string;
}

export function assessSubmission(input: SubmissionInput): SubmissionAssessment {
  const candidates = [...(input.sourceResultIds ?? [])];
  if (input.targetCount !== undefined && input.count !== undefined && input.targetCount !== input.count) {
    return { executable: false, reason: "数量冲突，必须先确认唯一目标数量。" };
  }
  if (input.kind === "refine" && candidates.length === 0) {
    return { executable: false, reason: "refine 必须先选择至少一张来源图片。" };
  }
  if (input.kind === "refine" && candidates.length > 1 && !input.modifyAll) {
    return {
      executable: false,
      question: "请指定要修改的图片编号，或明确要求全部修改。",
      candidates
    };
  }
  return { executable: true };
}

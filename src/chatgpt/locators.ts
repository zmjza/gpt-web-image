export type SemanticTarget = "composer" | "submit" | "login" | "verification" | "download";
export interface SemanticNode { id: string; role: string; name: string; visible: boolean; disabled?: boolean; }

export class SemanticLocatorError extends Error {
  public constructor(public readonly code: "LOCATOR_MISSING" | "LOCATOR_CONFLICT", target: SemanticTarget) { super(`${code}: ${target}`); }
}

const MATCHERS: Record<SemanticTarget, (node: SemanticNode) => boolean> = {
  composer: (node) => ["textbox", "combobox"].includes(node.role) && /message|prompt|消息|提问|聊天/i.test(node.name),
  submit: (node) => node.role === "button" && /send|submit|发送/i.test(node.name),
  login: (node) => ["button", "link"].includes(node.role) && /log\s*in|sign\s*in|登录/i.test(node.name),
  verification: (node) => /verify|captcha|验证|安全检查/i.test(node.name),
  download: (node) => ["button", "link"].includes(node.role) && /download|下载/i.test(node.name)
};

export function resolveSemanticTarget(nodes: SemanticNode[], target: SemanticTarget): SemanticNode {
  const candidates = nodes.filter((node) => node.visible && !node.disabled && MATCHERS[target](node));
  if (candidates.length === 0) throw new SemanticLocatorError("LOCATOR_MISSING", target);
  if (candidates.length !== 1) throw new SemanticLocatorError("LOCATOR_CONFLICT", target);
  return candidates[0] as SemanticNode;
}

import { createHash } from "node:crypto";
import type { ResponseAnchor } from "../tasks/model.js";

export interface ConversationTurn { ordinal: number; role: "user" | "assistant"; text: string; imageFingerprints: string[]; }

export function bindResponseAnchor(turns: ConversationTurn[], userTurnOrdinal: number, now = new Date()): ResponseAnchor {
  const userIndex = turns.findIndex((turn) => turn.ordinal === userTurnOrdinal && turn.role === "user");
  if (userIndex < 0) throw new Error("找不到本次用户消息");
  const following = turns.slice(userIndex + 1).filter((turn) => turn.role === "assistant");
  if (following.length !== 1) throw new Error("无法唯一绑定本轮助手回复");
  const assistant = following[0] as ConversationTurn;
  const semanticFingerprint = createHash("sha256").update(`${userTurnOrdinal}:${assistant.ordinal}:${assistant.text}:${assistant.imageFingerprints.join(",")}`).digest("hex");
  return { userTurnOrdinal, assistantTurnOrdinal: assistant.ordinal, semanticFingerprint, boundAt: now.toISOString() };
}

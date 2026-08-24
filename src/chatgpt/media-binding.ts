export interface RawMediaCardSnapshot {
  cardId: string | null;
  resultId: string | null;
  resourceUrl: string;
  downloadUrl: string | null;
  downloadResultId: string | null;
  viewerTitle: string | null;
  viewerAvailable: boolean;
  mediaOrdinal: number;
  loaded: boolean;
  width: number;
  height: number;
  visible: boolean;
  hidden: boolean;
  userTurnOrdinal: number;
  assistantTurnOrdinal: number;
}

export interface BoundMediaCard extends RawMediaCardSnapshot {
  cardId: string;
  resultId: string;
  fingerprint: string;
  downloadAvailable: true;
  downloadKind: "inline" | "viewer";
}

export class MediaBindingError extends Error {
  public readonly code = "MEDIA_BINDING_UNCERTAIN";
  public constructor(message: string) { super(`MEDIA_BINDING_UNCERTAIN: ${message}`); }
}

export function bindMediaCards(cards: readonly RawMediaCardSnapshot[], anchor: { userTurnOrdinal: number; assistantTurnOrdinal: number }): BoundMediaCard[] {
  const inAnchor = cards.filter((card) => card.userTurnOrdinal === anchor.userTurnOrdinal && card.assistantTurnOrdinal === anchor.assistantTurnOrdinal && card.visible && !card.hidden);
  const settled = inAnchor.filter((card) => card.loaded && card.width > 0 && card.height > 0);
  if (inAnchor.length > 0 && settled.length === 0) return [];
  const valid = settled.filter((card): card is RawMediaCardSnapshot & { cardId: string } => {
    if (!card.cardId || !card.resourceUrl) return false;
    if (card.downloadUrl) return !card.downloadResultId || !card.resultId || card.downloadResultId === card.resultId;
    return card.viewerAvailable && Boolean(card.viewerTitle) && card.mediaOrdinal > 0;
  });
  const ids = new Set<string>();
  for (const card of valid) {
    if (ids.has(card.cardId)) throw new MediaBindingError("可见生成媒体卡存在重复身份，无法一一对应。");
    ids.add(card.cardId);
  }
  if (settled.length !== valid.length) throw new MediaBindingError("本轮助手回复有图片，但没有唯一可下载原图资源。");
  return valid.map((card) => {
    const downloadKind = card.downloadUrl ? "inline" : "viewer";
    return { ...card, resultId: card.resultId || card.cardId, fingerprint: `${card.cardId}:${downloadKind}`, downloadAvailable: true, downloadKind };
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { bindMediaCards, MediaBindingError, type RawMediaCardSnapshot } from "../../src/chatgpt/media-binding.js";

const card = (overrides: Partial<RawMediaCardSnapshot> = {}): RawMediaCardSnapshot => ({
  cardId: "card-new",
  resultId: "result-new",
  resourceUrl: "https://chatgpt.test/generated-new.png",
  downloadUrl: "https://chatgpt.test/generated-new.png",
  downloadResultId: "result-new",
  viewerTitle: null,
  viewerAvailable: false,
  mediaOrdinal: 1,
  loaded: true,
  width: 1024,
  height: 1536,
  visible: true,
  hidden: false,
  userTurnOrdinal: 3,
  assistantTurnOrdinal: 4,
  ...overrides
});

test("binds only visible media cards in the adjacent assistant turn", () => {
  const result = bindMediaCards([
    card(),
    card({ cardId: "historical", resultId: "old", userTurnOrdinal: 1, assistantTurnOrdinal: 2 }),
    card({ cardId: "hidden-clone", resultId: "result-new", hidden: true, visible: false })
  ], { userTurnOrdinal: 3, assistantTurnOrdinal: 4 });
  assert.deepEqual(result.map((entry) => entry.cardId), ["card-new"]);
  assert.equal(result[0]?.downloadUrl, "https://chatgpt.test/generated-new.png");
});

test("refuses a visible adjacent card whose download belongs to another result", () => {
  assert.throws(
    () => bindMediaCards([
      card(),
      card({ cardId: "wrong-download", resultId: "result-wrong", downloadResultId: "old" })
    ], { userTurnOrdinal: 3, assistantTurnOrdinal: 4 }),
    (error: unknown) => error instanceof MediaBindingError && error.code === "MEDIA_BINDING_UNCERTAIN"
  );
});

test("refuses duplicate visible cards because their source cannot be uniquely mapped", () => {
  assert.throws(() => bindMediaCards([card(), card()], { userTurnOrdinal: 3, assistantTurnOrdinal: 4 }), (error: unknown) => error instanceof MediaBindingError && error.code === "MEDIA_BINDING_UNCERTAIN");
});

test("refuses a media card without an explicit original/download resource", () => {
  assert.throws(() => bindMediaCards([card({ downloadUrl: null })], { userTurnOrdinal: 3, assistantTurnOrdinal: 4 }), (error: unknown) => error instanceof MediaBindingError && error.code === "MEDIA_BINDING_UNCERTAIN");
});

test("keeps an incomplete lazy-loaded media card pending instead of failing early", () => {
  assert.deepEqual(bindMediaCards([card({ loaded: false, width: 0, height: 0, downloadUrl: null, downloadResultId: null })], { userTurnOrdinal: 3, assistantTurnOrdinal: 4 }), []);
});

test("binds a loaded card to a unique semantic image viewer when no inline download exists", () => {
  const result = bindMediaCards([card({ downloadUrl: null, downloadResultId: null, viewerTitle: "结果一", viewerAvailable: true })], { userTurnOrdinal: 3, assistantTurnOrdinal: 4 });
  assert.equal(result[0]?.downloadKind, "viewer");
  assert.equal(result[0]?.fingerprint, "card-new:viewer");
});

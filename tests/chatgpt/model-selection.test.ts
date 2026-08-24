import test from "node:test";
import assert from "node:assert/strict";
import { choosePreferredModel, classifyModelLabel, ModelSelectionError, type ModelOptionSnapshot } from "../../src/chatgpt/model-selection.js";

const option = (modelKey: ModelOptionSnapshot["modelKey"], available: boolean, selected = false): ModelOptionSnapshot => ({
  modelKey,
  label: modelKey,
  available,
  selected
});

test("selects GPT-5.6 Sol high before medium and instant", () => {
  assert.equal(choosePreferredModel([
    option("gpt-5.6-sol-high", true),
    option("gpt-5.6-sol-medium", true),
    option("instant", true)
  ]).modelKey, "gpt-5.6-sol-high");
  assert.equal(choosePreferredModel([
    option("gpt-5.6-sol-high", false),
    option("gpt-5.6-sol-medium", true),
    option("instant", true)
  ]).modelKey, "gpt-5.6-sol-medium");
  assert.equal(choosePreferredModel([
    option("gpt-5.6-sol-high", false),
    option("gpt-5.6-sol-medium", false),
    option("instant", true)
  ]).modelKey, "instant");
});

test("rejects a mixed nested model menu container as a concrete option", () => {
  assert.equal(classifyModelLabel("模型 GPT-5.6 Sol 高 GPT-5.6 Sol 中 极速"), null);
});

test("reports the daily image limit only when all three models are explicitly unavailable", () => {
  assert.throws(() => choosePreferredModel([
    option("gpt-5.6-sol-high", false),
    option("gpt-5.6-sol-medium", false),
    option("instant", false)
  ]), (error: unknown) => error instanceof ModelSelectionError
    && error.code === "DAILY_IMAGE_LIMIT_REACHED"
    && error.message === "单日生图已达限额，暂时不可生图。");
  assert.throws(() => choosePreferredModel([]), (error: unknown) => error instanceof ModelSelectionError && error.code === "MODEL_SELECTION_UNCERTAIN");
});

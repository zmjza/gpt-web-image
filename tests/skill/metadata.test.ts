import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("T02 metadata declares explicit and implicit activation boundaries", () => {
  const skill = readFileSync(".agents/skills/gpt-web-image/SKILL.md", "utf8");
  const agent = readFileSync("agents/openai.yaml", "utf8");
  assert.match(skill, /gpt-web-image/);
  assert.match(skill, /\$gpt-web-image/);
  assert.match(skill, /隐式/);
  assert.match(skill, /查看|分析|压缩/);
  assert.match(skill, /文生图/);
  assert.match(skill, /图生图.*edit --reference/);
  assert.match(skill, /图改图.*refine/);
  assert.match(skill, /跨进程.*FIFO/);
  assert.match(skill, /不(?:读取|打开|切换).*模型菜单/);
  assert.match(skill, /当前已选模型/);
  assert.match(skill, /liran-image2/);
  assert.match(agent, /GPT 网页生图/);
});

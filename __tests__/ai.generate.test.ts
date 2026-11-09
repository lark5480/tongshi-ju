import { test } from "node:test";
import assert from "node:assert/strict";

import type { AiGenerateInput } from "../content/domains/schema";
import { domainBank } from "../lib/content/server-bank";
import { generateBatch } from "../lib/ai/generate";
import type { AiProvider } from "../lib/ai/provider";

function fakeProvider(value: unknown): AiProvider {
  return {
    name: "fake",
    async generate() {
      return value;
    },
    async generateWithMeta() {
      throw new Error("generateWithMeta 不在本测试范围内");
    },
  };
}

const INPUT: AiGenerateInput = {
  domain: "gaming",
  topic: "经典作品",
  difficulty: 1,
  count: 1,
};

test("generateBatch：合法批次通过校验并标记 origin=ai", async () => {
  const result = await generateBatch(
    INPUT,
    fakeProvider({
      questions: [
        {
          topic: "经典作品",
          difficulty: 1,
          type: "single",
          stem: "《空洞骑士》的开发商 Team Cherry 位于哪个国家？",
          options: ["澳大利亚", "新西兰", "加拿大", "英国"],
          answer: "澳大利亚",
          explanation: "Team Cherry 是位于澳大利亚阿德莱德的小型独立游戏工作室。",
        },
      ],
    })
  );

  assert.equal(result.batchValid, true);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]?.origin, "ai");
  assert.match(result.accepted[0]?.id ?? "", /^gaming-ai-[0-9a-f]{8}$/);
  assert.equal(result.rejected.length, 0);
});

test("generateBatch：非法 JSON 整批拒绝", async () => {
  const result = await generateBatch(INPUT, fakeProvider("不是 JSON"));

  assert.equal(result.batchValid, false);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, "json_invalid");
});

test("generateBatch：与 seed 题干重复时被拒", async () => {
  const seed = domainBank("gaming")[0];
  assert.ok(seed, "gaming 题库不应为空");

  const result = await generateBatch(
    INPUT,
    fakeProvider({
      questions: [
        {
          topic: seed.topic,
          difficulty: seed.difficulty,
          type: "single",
          stem: seed.stem,
          options: ["A", "B", "C", "D"],
          answer: "A",
          explanation: "这是一段足够长的解析，用来触发查重而不是长度校验。",
        },
      ],
    })
  );

  assert.equal(result.batchValid, true);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected[0]?.reason, "duplicate_fingerprint");
});

test("generateBatch：知识点不在白名单时直接报错（不调模型）", async () => {
  let called = false;
  const provider = fakeProvider({ questions: [] });
  provider.generate = async () => {
    called = true;
    return { questions: [] };
  };

  await assert.rejects(
    () => generateBatch({ ...INPUT, topic: "不存在的知识点" }, provider),
    /不属于/
  );
  assert.equal(called, false);
});

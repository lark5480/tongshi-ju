import { test } from "node:test";
import assert from "node:assert/strict";

import type { Question } from "../types";
import { shuffleOptions } from "../lib/engine/options";

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "gaming-0001",
    domain: "gaming",
    topic: "经典作品",
    difficulty: 1,
    type: "single",
    stem: "题干",
    options: ["A", "B", "C", "D"],
    answer: "A",
    explanation: "解析",
    origin: "seed",
    fingerprint: "00000000",
    ...overrides,
  };
}

test("打乱选项：保留全部选项与答案，不修改原题", () => {
  const q = question();
  const out = shuffleOptions(q, 42);

  assert.deepEqual([...out.options].sort(), [...q.options].sort());
  assert.equal(out.answer, q.answer);
  assert.deepEqual(q.options, ["A", "B", "C", "D"], "入参题目不应被修改");
});

test("同一题 + 同一 seed → 同一选项顺序", () => {
  const a = shuffleOptions(question(), 12345);
  const b = shuffleOptions(question(), 12345);
  assert.deepEqual(a.options, b.options);
});

test("不同 seed 会改变至少一种选项顺序", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 20; seed++) {
    orders.add(shuffleOptions(question(), seed).options.join("|"));
  }
  assert.ok(orders.size > 1, "选项顺序不应永远固定");
});

test("多选与判断题的答案仍完整保留", () => {
  const multi = question({
    type: "multi",
    options: ["甲", "乙", "丙", "丁"],
    answer: ["乙", "丁"],
  });
  const judge = question({
    id: "gaming-0002",
    type: "judge",
    options: ["正确", "错误"],
    answer: "正确",
  });

  const multiOut = shuffleOptions(multi, 7);
  const judgeOut = shuffleOptions(judge, 8);

  assert.ok(multiOut.options.includes("乙"));
  assert.ok(multiOut.options.includes("丁"));
  assert.ok(judgeOut.options.includes("正确"));
});

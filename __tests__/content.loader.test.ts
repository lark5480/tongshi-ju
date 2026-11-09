import { test } from "node:test";
import assert from "node:assert/strict";

import {
  hydrate,
  loadDomainQuestions,
  type AiQuestionFileEntry,
  type QuestionFileEntry,
} from "../lib/content/loader";
import { findAnyQuestion } from "../lib/content/server-bank";

const seedEntry: QuestionFileEntry = {
  id: "gaming-0001",
  topic: "经典作品",
  difficulty: 1,
  type: "single",
  stem: "测试题干",
  options: ["A", "B"],
  answer: "A",
  explanation: "测试解析",
};

test("hydrate 默认注入 seed 来源", () => {
  const [question] = hydrate("gaming", [seedEntry]);
  assert.equal(question?.origin, "seed");
  assert.equal(question?.domain, "gaming");
});

test("hydrate 注入 ai 来源并保留审核字段", () => {
  const aiEntry: AiQuestionFileEntry = {
    ...seedEntry,
    id: "gaming-ai-00000001",
    batchId: "ai-test",
    reviewedAt: "2026-11-09",
  };
  const [question] = hydrate("gaming", [aiEntry], "ai");
  assert.equal(question?.origin, "ai");
  assert.equal(question?.batchId, "ai-test");
});

test("findAnyQuestion：seed 题可查，未知 id 返回 undefined", () => {
  assert.equal(findAnyQuestion("gaming-0001")?.id, "gaming-0001");
  assert.equal(findAnyQuestion("gaming-ai-ffffffff"), undefined);
});

test("加载域题库：空 AI 文件不影响 seed 题", async () => {
  const questions = await loadDomainQuestions("gaming");
  assert.ok(questions.length > 0, "gaming 题库不应为空");
  assert.ok(
    questions.every((q) => q.origin === "seed"),
    "当前 AI 题池为空时，加载结果应全部是 seed 题"
  );
});

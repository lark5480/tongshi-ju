import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalAnswer,
  isCorrect,
  normalizeAnswer,
  normalizeAnswerList,
  toAnswerArray,
  validateQuestionShape,
} from "../lib/engine/answer";

test("归一化去掉空白、标点并统一全半角", () => {
  assert.equal(normalizeAnswer(" 正确 "), "正确");
  assert.equal(normalizeAnswer("ＡＢＣ"), "abc");
  assert.equal(normalizeAnswer("Hello, World!"), "helloworld");
});

test("单选判定：归一化后相等即算对", () => {
  assert.equal(isCorrect("single", "正确", "正确"), true);
  assert.equal(isCorrect("single", "正确", " 正确 "), true);
  assert.equal(isCorrect("single", "正确", "错误"), false);
});

test("判断题判定", () => {
  assert.equal(isCorrect("judge", "正确", "正确"), true);
  assert.equal(isCorrect("judge", "错误", "错误"), true);
  assert.equal(isCorrect("judge", "错误", "正确"), false);
});

test("多选：必须全对才得分", () => {
  assert.equal(isCorrect("multi", ["A", "B"], ["B", "A"]), true, "顺序无关");
  assert.equal(isCorrect("multi", ["A", "B"], ["A"]), false, "少选不得分");
  assert.equal(isCorrect("multi", ["A", "B"], ["A", "C"]), false, "错选不得分");
  assert.equal(isCorrect("multi", ["A", "B"], ["A", "B", "C"]), false, "多选不得分");
});

test("多选：空答案不得分", () => {
  assert.equal(isCorrect("multi", ["A"], []), false);
});

test("normalizeAnswerList 去重并排序", () => {
  assert.deepEqual(normalizeAnswerList(["B", "A", "B"]), ["a", "b"]);
});

test("toAnswerArray 统一单值与数组", () => {
  assert.deepEqual(toAnswerArray("A"), ["A"]);
  assert.deepEqual(toAnswerArray(["A", "B"]), ["A", "B"]);
});

test("canonicalAnswer：multi 按原始字符串字典序排序并去重", () => {
  assert.deepEqual(canonicalAnswer("multi", ["B", "A", "B"]), ["A", "B"]);
  assert.equal(canonicalAnswer("single", ["A"]), "A");
});

test("validateQuestionShape：答案必须命中选项", () => {
  const errors = validateQuestionShape({
    type: "single",
    options: ["A", "B", "C", "D"],
    answer: "Z",
    explanation: "一段足够长的解析内容",
  });
  assert.ok(errors.some((e) => e.includes("不在选项中")));
});

test("validateQuestionShape：单选答案必须唯一", () => {
  const errors = validateQuestionShape({
    type: "single",
    options: ["A", "B"],
    answer: ["A", "B"],
    explanation: "一段足够长的解析内容",
  });
  assert.ok(errors.some((e) => e.includes("唯一")));
});

test("validateQuestionShape：多选答案数量必须在 2 到选项数之间", () => {
  const tooFew = validateQuestionShape({
    type: "multi",
    options: ["A", "B", "C", "D"],
    answer: ["A"],
    explanation: "一段足够长的解析内容",
  });
  assert.ok(tooFew.some((e) => e.includes("至少应有 2 个")));

  const tooMany = validateQuestionShape({
    type: "multi",
    options: ["A", "B"],
    answer: ["A", "B", "C"],
    explanation: "一段足够长的解析内容",
  });
  assert.ok(tooMany.some((e) => e.includes("超过选项数量")));
});

test("validateQuestionShape：判断题必须恰好 2 个选项", () => {
  const bad = validateQuestionShape({
    type: "judge",
    options: ["正确", "错误", "也许"],
    answer: "正确",
    explanation: "一段足够长的解析内容",
  });
  assert.ok(bad.some((e) => e.includes("2 个选项")));
});

test("validateQuestionShape：选项重复被拒", () => {
  const errors = validateQuestionShape({
    type: "single",
    options: ["A", "A", "C", "D"],
    answer: "A",
    explanation: "一段足够长的解析内容",
  });
  assert.ok(errors.some((e) => e.includes("重复")));
});

test("validateQuestionShape：解析过短被拒", () => {
  const errors = validateQuestionShape({
    type: "single",
    options: ["A", "B"],
    answer: "A",
    explanation: "短",
  });
  assert.ok(errors.some((e) => e.includes("解析")));
});

test("validateQuestionShape：合法题目无错误", () => {
  const errors = validateQuestionShape({
    type: "single",
    options: ["A", "B", "C", "D"],
    answer: "B",
    explanation: "这是一段足够长度的解析内容，用于说明为什么选 B。",
  });
  assert.deepEqual(errors, []);
});

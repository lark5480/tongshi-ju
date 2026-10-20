import { test } from "node:test";
import assert from "node:assert/strict";

import { validateAiBatch, type ValidationResult } from "../lib/ai/validate";
import { addToIndex, type DomainTokenIndex } from "../lib/ai/dedupe";
import { domainBank } from "../lib/content/server-bank";
import { normalizeStem, tokenize } from "../lib/content/fingerprint";

/**
 * 构造校验上下文：**带上真实题库的指纹与 token 索引**，
 * 这样第 8、9 步（查重）才有东西可查。
 */
function ctx() {
  const knownFingerprints = new Map<string, string>();
  const tokenIndex: DomainTokenIndex = new Map();
  for (const q of domainBank("gaming")) {
    knownFingerprints.set(q.fingerprint, q.id);
    addToIndex(tokenIndex, q);
  }
  return {
    domain: "gaming" as const,
    knownFingerprints,
    tokenIndex,
    batchId: "test-batch",
    makeId: (domain: string, stem: string) => `${domain}-ai-${stem.length.toString(16)}`,
  };
}

/** 构造一条合法的 AI 题目。 */
function goodDraft(overrides: Record<string, unknown> = {}) {
  return {
    topic: "经典作品",
    difficulty: 1,
    type: "single",
    stem: "下列哪款游戏由宫崎骏所在的吉卜力工作室制作？",
    options: ["《幽灵公主》", "《塞尔达传说》", "《空洞骑士》", "《只狼》"],
    answer: "《幽灵公主》",
    explanation: "《幽灵公主》是吉卜力工作室 1997 年的作品，导演为宫崎骏。",
    ...overrides,
  };
}

function run(payload: unknown): ValidationResult {
  return validateAiBatch(payload, ctx());
}

test("合法批次被接受", () => {
  const res = run({ questions: [goodDraft()] });
  assert.equal(res.batchValid, true);
  assert.equal(res.accepted.length, 1);
  assert.equal(res.rejected.length, 0);
  assert.equal(res.accepted[0].origin, "ai");
  assert.equal(res.accepted[0].domain, "gaming");
  assert.ok(res.accepted[0].fingerprint.length === 8);
});

test("步骤 1：非 JSON 输入整批拒绝", () => {
  const res = run("这不是 JSON");
  assert.equal(res.batchValid, false);
  assert.equal(res.rejected[0].reason, "json_invalid");
});

test("步骤 2：字段缺失被拒", () => {
  const res = run({ questions: [{ stem: "题干", options: ["A", "B"] }] });
  assert.equal(res.batchValid, false);
  assert.equal(res.rejected[0].reason, "schema_invalid");
});

test("步骤 2：questions 为空数组被拒", () => {
  const res = run({ questions: [] });
  assert.equal(res.batchValid, false);
  assert.equal(res.rejected[0].reason, "schema_invalid");
});

test("步骤 3：topic 不在白名单被拒（防串域）", () => {
  const res = run({ questions: [goodDraft({ topic: "航天" })] });
  assert.equal(res.rejected[0].reason, "topic_unknown");
});

test("步骤 5：答案不在选项中被拒", () => {
  const res = run({ questions: [goodDraft({ answer: "《不存在的游戏》" })] });
  assert.equal(res.rejected[0].reason, "answer_not_in_options");
});

test("步骤 6：歧义句式被拒", () => {
  for (const phrase of ["以上都对", "以下哪个不是", "下列说法正确的是"]) {
    const res = run({ questions: [goodDraft({ stem: `${phrase}，下列作品正确的是？` })] });
    assert.equal(res.rejected[0]?.reason, "ambiguous_stem", `未拦截：${phrase}`);
  }
});

test("步骤 7：解析过短被拒（10-14 字触发链内检查，<10 字由 schema 拦下）", () => {
  const res = run({ questions: [goodDraft({ explanation: "这是一段超过十字的解析" })] });
  assert.equal(res.rejected[0].reason, "explanation_too_short");

  const tooShort = run({ questions: [goodDraft({ explanation: "短" })] });
  assert.equal(tooShort.batchValid, false);
  assert.equal(tooShort.rejected[0].reason, "schema_invalid");
});

test("步骤 8：与全库重复的题干被拒", () => {
  const existing = domainBank("gaming")[0];
  const res = run({ questions: [goodDraft({ stem: existing.stem })] });
  assert.equal(res.rejected[0].reason, "duplicate_fingerprint");
});

test("步骤 9：与同域题目高度相似被拒", () => {
  const existing = domainBank("gaming")[0];
  // 换用近义词（“采用”→“使用”）：语义几乎相同，但归一化后指纹不同，
  // 只能靠 token 近似度拦下 → 命中步骤 9。
  // 注意：不能只改标点，`normalizeStem` 会剥掉标点，那样指纹相同会先命中步骤 8。
  const res = run({ questions: [goodDraft({ stem: existing.stem.replace("采用了", "使用了") })] });
  assert.equal(res.rejected[0].reason, "near_duplicate");
});

test("步骤 10：敏感词被拒", () => {
  const res = run({ questions: [goodDraft({ stem: "下列关于制毒流程的说法正确的是？" })] });
  assert.equal(res.rejected[0].reason, "sensitive_content");
});

test("批内重复：第二题与第一题重复时被拒", () => {
  const res = run({ questions: [goodDraft(), goodDraft()] });
  assert.equal(res.accepted.length, 1);
  assert.equal(res.rejected.length, 1);
});

test("多题批次：部分通过部分拒绝", () => {
  const res = run({
    questions: [
      goodDraft(),
      goodDraft({ answer: "不存在" }),
      goodDraft({ stem: "另一道完全不同的题目，问的是完全不同的事情是什么？" }),
    ],
  });
  assert.equal(res.accepted.length, 2);
  assert.equal(res.rejected.length, 1);
});

test("变体题记录 variantOf", () => {
  const local = { ...ctx(), variantOf: "gaming-0001" };
  const res = validateAiBatch({ questions: [goodDraft()] }, local);
  assert.equal(res.accepted[0].variantOf, "gaming-0001");
});

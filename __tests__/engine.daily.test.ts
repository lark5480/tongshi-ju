import { test } from "node:test";
import assert from "node:assert/strict";

import type { DomainId, Question } from "../types";
import {
  DEFAULT_DAILY_COUNT,
  buildDailySet,
  canonicalDomains,
  dailySeed,
  difficultyCurve,
  pickDomainsBySeed,
  pickRandomDomains,
} from "../lib/engine/daily";

/** 构造测试题池。 */
function makePool(domains: DomainId[], perDomain: number): Partial<Record<DomainId, Question[]>> {
  const pool: Partial<Record<DomainId, Question[]>> = {};
  for (const d of domains) {
    pool[d] = Array.from({ length: perDomain }, (_, i) => ({
      id: `${d}-${String(i).padStart(4, "0")}`,
      domain: d,
      topic: "T",
      difficulty: ((i % 3) + 1) as 1 | 2 | 3,
      type: "single" as const,
      stem: `题目 ${d} ${i}`,
      options: ["A", "B", "C", "D"],
      answer: "A",
      explanation: "解析",
      origin: "seed" as const,
      fingerprint: "00000000",
    }));
  }
  return pool;
}

const DOMS: DomainId[] = ["gaming", "tech", "life"];

test("同一天 + 同一组领域 → 同一份题集（确定性）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("不同日期 → 不同题集", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const b = buildDailySet({ dateKey: "2026-10-21", domains: DOMS, pool });
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("不同领域集合 → 不同题集", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "tech"], pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "life"], pool });
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("抽题不重复（题量充足时）", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const ids = picks.map((p) => p.question.id);
  assert.equal(new Set(ids).size, ids.length, "题集内不应出现重复题");
});

test("默认题数为 5", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  assert.equal(picks.length, DEFAULT_DAILY_COUNT);
});

test("每题都来自所选领域", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  for (const p of picks) {
    assert.ok(DOMS.includes(p.question.domain), `越界领域 ${p.question.domain}`);
  }
});

test("领域轮转覆盖：三个领域都至少出现一次", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const used = new Set(picks.map((p) => p.question.domain));
  assert.equal(used.size, DOMS.length, "应覆盖全部所选领域");
});

test("最后一题是彩蛋题，且与上一题不同域", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const last = picks[picks.length - 1];
  const prev = picks[picks.length - 2];
  assert.equal(last.isEgg, true, "末题应标记为彩蛋题");
  assert.notEqual(last.question.domain, prev.question.domain, "彩蛋题应与上一题不同域");
});

test("显式 seed 优先于 dateKey（duel 用房间种子）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "x", domains: DOMS, pool, seed: 12345 });
  const b = buildDailySet({ dateKey: "y", domains: DOMS, pool, seed: 12345 });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
  const c = buildDailySet({ dateKey: "x", domains: DOMS, pool, seed: 999 });
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    c.map((p) => p.question.id)
  );
});

test("选项顺序确定，且答案仍在选项中", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });

  assert.deepEqual(
    a.map((p) => p.question.options),
    b.map((p) => p.question.options),
    "同一题集必须得到同一选项顺序"
  );
  for (const pick of a) {
    const answers = Array.isArray(pick.question.answer)
      ? pick.question.answer
      : [pick.question.answer];
    for (const answer of answers) {
      assert.ok(pick.question.options.includes(answer), `选项里找不到答案 ${answer}`);
    }
  }
});

test("选项会随种子变化：不会所有题永远把答案放首位", () => {
  const pool = makePool(DOMS, 40);
  let shifted = 0;

  for (let day = 1; day <= 30; day++) {
    const dateKey = `2026-11-${String(day).padStart(2, "0")}`;
    const picks = buildDailySet({ dateKey, domains: DOMS, pool });
    for (const pick of picks) {
      const answer = Array.isArray(pick.question.answer)
        ? pick.question.answer[0]
        : pick.question.answer;
      if (pick.question.options[0] !== answer) shifted++;
    }
  }

  assert.ok(shifted > 0, "选项顺序应随日期种子变化");
});

test("显式 seed 下选项顺序一致（duel / PK 共用）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "x", domains: DOMS, pool, seed: 12345 });
  const b = buildDailySet({ dateKey: "y", domains: DOMS, pool, seed: 12345 });

  assert.deepEqual(
    a.map((p) => p.question.options),
    b.map((p) => p.question.options),
    "同一 seed 必须得到同一选项顺序"
  );
});

test("allowedTypes 过滤题型：duel 可排除多选", () => {
  const pool = makePool(["gaming"], 12);
  const questions = pool.gaming ?? [];

  // 把前 8 题改成多选，确保两种题型都有足够候选
  for (let i = 0; i < 8; i++) {
    questions[i].type = "multi";
    questions[i].options = ["甲", "乙", "丙", "丁"];
    questions[i].answer = ["乙", "甲"];
  }

  const singles = buildDailySet({
    dateKey: "x",
    domains: ["gaming"],
    pool,
    count: 5,
    allowedTypes: ["single", "judge"],
  });
  const multis = buildDailySet({
    dateKey: "x",
    domains: ["gaming"],
    pool,
    count: 5,
    allowedTypes: ["multi"],
  });

  assert.equal(singles.length, 5);
  assert.ok(singles.every((p) => p.question.type !== "multi"));
  assert.equal(multis.length, 5);
  assert.ok(multis.every((p) => p.question.type === "multi"));
});

test("题量不足时允许重复兜底，绝不返回空", () => {
  const pool = makePool(["gaming"], 2);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming"], pool, count: 5 });
  assert.equal(picks.length, 5, "题量不足时应重复填满，而不是返回空");
});

test("某域为空时用其他域补位", () => {
  const pool = makePool(["gaming", "tech"], 40);
  delete pool.gaming;
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "tech"], pool });
  assert.ok(picks.length > 0);
  for (const p of picks) assert.equal(p.question.domain, "tech");
});

test("全部领域为空时返回空数组（由调用方提示）", () => {
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming"], pool: {} });
  assert.deepEqual(picks, []);
});

test("纯函数：不修改入参题池", () => {
  const pool = makePool(DOMS, 10);
  const before = JSON.stringify(pool);
  buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  assert.equal(JSON.stringify(pool), before, "题池不应被修改");
});

test("dailySeed 稳定且随领域变化", () => {
  assert.equal(dailySeed("2026-10-20", DOMS), dailySeed("2026-10-20", DOMS));
  assert.notEqual(dailySeed("2026-10-20", DOMS), dailySeed("2026-10-20", ["gaming"]));
});

test("dailySeed 与领域输入顺序无关（同一组领域 = 集合）", () => {
  assert.equal(
    dailySeed("2026-10-20", ["gaming", "tech", "life"]),
    dailySeed("2026-10-20", ["life", "gaming", "tech"])
  );
  assert.equal(
    dailySeed("2026-10-20", ["gaming", "tech"]),
    dailySeed("2026-10-20", ["tech", "gaming"])
  );
});

test("同一组领域、不同点选顺序 → 同一份题集（全网同题的前提）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "tech", "life"], pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: ["life", "gaming", "tech"], pool });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id),
    "领域顺序不同却拿到不同题集，会直接破坏「全网同题」"
  );
});

test("canonicalDomains 返回排序副本，不修改入参", () => {
  const input: DomainId[] = ["life", "gaming", "tech"];
  const out = canonicalDomains(input);
  assert.deepEqual(out, ["gaming", "life", "tech"]);
  assert.deepEqual(input, ["life", "gaming", "tech"], "入参不应被修改");
});

test("difficultyCurve：5 题时为 1,1,2,2,3", () => {
  assert.deepEqual(difficultyCurve(5), [1, 1, 2, 2, 3]);
});

test("pickRandomDomains：同一天结果一致，跨天可不同", () => {
  const a = pickRandomDomains("2026-10-20", DOMS, 3);
  const b = pickRandomDomains("2026-10-20", DOMS, 3);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
});

test("pickDomainsBySeed：同 seed 一致，数量不超过候选数", () => {
  const a = pickDomainsBySeed(42, DOMS, 3);
  const b = pickDomainsBySeed(42, DOMS, 3);
  assert.deepEqual(a, b);
  assert.equal(pickDomainsBySeed(42, ["gaming"], 3).length, 1);
  assert.deepEqual(pickDomainsBySeed(42, [], 3), []);
});

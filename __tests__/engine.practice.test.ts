import { test } from "node:test";
import assert from "node:assert/strict";

import { PRACTICE_LIMIT, buildPracticeSet } from "../lib/engine/practice";
import { createWrongEntry } from "../lib/engine/repetition";
import type { DomainId, Question, WrongEntry } from "../types";

const NOW = 1_700_000_000_000;
const DAY_MS = 86400000;

function question(id: string, domain: DomainId = "gaming"): Question {
  return {
    id,
    domain,
    topic: "主机与PC",
    difficulty: 1,
    type: "single",
    stem: id,
    options: ["A", "B"],
    answer: "A",
    explanation: "",
    origin: "seed",
    fingerprint: id,
  };
}

function entry(questionId: string, nextDueAt: number, domain: DomainId = "gaming"): WrongEntry {
  return {
    ...createWrongEntry({ questionId, domain, topic: "主机与PC", now: NOW }),
    nextDueAt,
  };
}

test("只包含到期条目：未到期的错题不进入练习", () => {
  const entries = [entry("gaming-0001", NOW - 1), entry("gaming-0002", NOW + DAY_MS)];
  const picks = buildPracticeSet(
    entries,
    { gaming: [question("gaming-0001"), question("gaming-0002")] },
    NOW
  );

  assert.deepEqual(
    picks.map((p) => p.question.id),
    ["gaming-0001"]
  );
});

test("排序确定：先按 nextDueAt 升序，同一时刻按 questionId 字典序", () => {
  const entries = [
    entry("gaming-0002", NOW - 100),
    entry("gaming-0003", NOW - 200),
    entry("gaming-0001", NOW - 100),
  ];
  const pool = {
    gaming: [question("gaming-0001"), question("gaming-0002"), question("gaming-0003")],
  };

  const picks = buildPracticeSet(entries, pool, NOW);

  assert.deepEqual(
    picks.map((p) => p.question.id),
    ["gaming-0003", "gaming-0001", "gaming-0002"]
  );
});

test("题池里找不到完整题目时跳过，不报错", () => {
  const entries = [entry("gaming-0001", NOW - 2), entry("gaming-0009", NOW - 1)];
  const picks = buildPracticeSet(entries, { gaming: [question("gaming-0001")] }, NOW);

  assert.deepEqual(
    picks.map((p) => p.question.id),
    ["gaming-0001"]
  );
});

test("同一 questionId 去重，保留最先到期的那条", () => {
  const entries = [entry("gaming-0001", NOW - 10), entry("gaming-0001", NOW - 100)];
  const picks = buildPracticeSet(entries, { gaming: [question("gaming-0001")] }, NOW);

  assert.equal(picks.length, 1);
  assert.equal(picks[0].entry.nextDueAt, NOW - 100);
});

test("limit 截断，limit <= 0 返回空数组", () => {
  const entries = Array.from({ length: 4 }, (_, i) => entry(`gaming-000${i + 1}`, NOW - 100 + i));
  const pool = { gaming: entries.map((e) => question(e.questionId)) };

  assert.equal(buildPracticeSet(entries, pool, NOW, 2).length, 2);
  assert.deepEqual(buildPracticeSet(entries, pool, NOW, 0), []);
  assert.deepEqual(buildPracticeSet(entries, pool, NOW, -1), []);
});

test("默认上限为 PRACTICE_LIMIT", () => {
  const entries = Array.from({ length: PRACTICE_LIMIT + 2 }, (_, i) =>
    entry(`gaming-${String(i + 1).padStart(4, "0")}`, NOW - 100 - i)
  );
  const pool = { gaming: entries.map((e) => question(e.questionId)) };

  assert.equal(buildPracticeSet(entries, pool, NOW).length, PRACTICE_LIMIT);
});

test("不修改输入数组与条目", () => {
  const entries = [entry("gaming-0002", NOW - 100), entry("gaming-0001", NOW - 200)];
  const pool = { gaming: [question("gaming-0001"), question("gaming-0002")] };
  const entriesBefore = JSON.stringify(entries);
  const poolBefore = JSON.stringify(pool);

  buildPracticeSet(entries, pool, NOW);

  assert.equal(JSON.stringify(entries), entriesBefore);
  assert.equal(JSON.stringify(pool), poolBefore);
});

test("练习题选项顺序确定，答案仍在选项中", () => {
  const entries = [entry("gaming-0001", NOW - 1)];
  const pool = { gaming: [question("gaming-0001")] };

  const a = buildPracticeSet(entries, pool, NOW);
  const b = buildPracticeSet(entries, pool, NOW);

  assert.deepEqual(a[0].question.options, b[0].question.options);
  assert.ok(a[0].question.options.includes("A"));
});

test("练习题的选项顺序会随到期批次变化", () => {
  const orders = new Set<string>();

  for (let i = 1; i <= 20; i++) {
    const entries = [entry("gaming-0001", NOW - i)];
    const picks = buildPracticeSet(entries, { gaming: [question("gaming-0001")] }, NOW);
    orders.add(picks[0].question.options.join("|"));
  }

  assert.ok(orders.size > 1, "选项顺序不应永远固定");
});

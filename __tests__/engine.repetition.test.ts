import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GRADUATE_STREAK,
  INTERVALS_DAYS,
  createWrongEntry,
  dueEntries,
  isDue,
  masteryRatio,
  onCorrect,
  onWrong,
} from "../lib/engine/repetition";

const NOW = 1_700_000_000_000;

function entry() {
  return createWrongEntry({
    questionId: "gaming-0001",
    domain: "gaming",
    topic: "经典作品",
    now: NOW,
  });
}

test("新建错题条目：初始连击 0、间隔为第一级", () => {
  const e = entry();
  assert.equal(e.streak, 0);
  assert.equal(e.wrongCount, 1);
  assert.equal(e.nextDueAt, NOW + INTERVALS_DAYS[0] * 86400000);
});

test("答错：连击归零、错次 +1、间隔重置为第一级", () => {
  const e = onWrong(entry(), NOW);
  assert.equal(e.streak, 0);
  assert.equal(e.wrongCount, 2);
  assert.equal(e.nextDueAt, NOW + INTERVALS_DAYS[0] * 86400000);
});

test("间隔序列为 1 → 3 → 7 → 15 → 30 天", () => {
  assert.deepEqual([...INTERVALS_DAYS], [1, 3, 7, 15, 30]);
});

test("连续答对 2 次即毕业（返回 null）", () => {
  const e = entry();
  const first = onCorrect(e, NOW);
  assert.ok(first);
  assert.equal(first.streak, 1);
  const second = onCorrect(first, NOW);
  assert.equal(second, null, "毕业应返回 null");
  assert.equal(GRADUATE_STREAK, 2);
});

test("答对推进间隔：1 天 → 3 天 → 7 天", () => {
  const e = entry();
  const s1 = onCorrect(e, NOW);
  assert.equal(s1?.nextDueAt, NOW + INTERVALS_DAYS[1] * 86400000);
  const s2 = onCorrect(s1!, NOW);
  assert.equal(s2, null, "第二次答对即毕业");
});

test("难度因子下降使间隔停留在当前级", () => {
  let e = entry();
  e = { ...e, ease: 1.5 };
  const next = onCorrect(e, NOW);
  assert.ok(next);
  // ease < 2.5 时不推进级，仍是第一级
  assert.equal(next.nextDueAt, NOW + INTERVALS_DAYS[0] * 86400000);
});

test("到期判断", () => {
  const e = entry();
  assert.equal(isDue(e, NOW), false);
  assert.equal(isDue(e, NOW + INTERVALS_DAYS[0] * 86400000), true);
});

test("dueEntries 过滤出到期条目", () => {
  const e = entry();
  assert.equal(dueEntries([e], NOW).length, 0);
  assert.equal(dueEntries([e], NOW + 2 * 86400000).length, 1);
});

test("掌握进度：0 题为 1，有题按连击比例", () => {
  assert.equal(masteryRatio([]), 1);
  // 一题连对 1 次（毕业需 2 次）→ 掌握 1/4
  const entries = [
    { ...entry(), streak: 1 },
    { ...entry(), questionId: "gaming-0002", streak: 0 },
  ];
  assert.equal(masteryRatio(entries), 0.25);
  // 两题都连对 1 次 → 掌握 2/4
  const allHalf = [
    { ...entry(), streak: 1 },
    { ...entry(), questionId: "gaming-0002", streak: 1 },
  ];
  assert.equal(masteryRatio(allHalf), 0.5);
});

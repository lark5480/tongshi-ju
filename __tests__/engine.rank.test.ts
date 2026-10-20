import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RANK_TIERS,
  RANK_WEIGHTS,
  computeRank,
  countTopicsTouched,
  domainSetKey,
  rankValue,
  totalsFromHistory,
  type RankInput,
} from "../lib/engine/rank";

const ZERO: RankInput = {
  totalCorrect: 0,
  totalPlayed: 0,
  totalStars: 0,
  topicsTouched: 0,
  bestCombo: 0,
  bestStreak: 0,
};

test("通识值：全零输入为 0", () => {
  assert.equal(rankValue(ZERO), 0);
});

test("通识值：负数输入被夹到 0（历史脏数据不会扣段位）", () => {
  const v = rankValue({ ...ZERO, totalCorrect: -50, totalStars: -10 });
  assert.equal(v, 0);
});

test("通识值：各维度按权重累加", () => {
  const v = rankValue({
    totalCorrect: 10,
    totalPlayed: 5,
    totalStars: 4,
    topicsTouched: 7,
    bestCombo: 3,
    bestStreak: 6,
  });
  const expected =
    10 * RANK_WEIGHTS.correct +
    5 * RANK_WEIGHTS.played +
    4 * RANK_WEIGHTS.star +
    7 * RANK_WEIGHTS.topic +
    3 * RANK_WEIGHTS.combo +
    6 * RANK_WEIGHTS.streakDay;
  assert.equal(v, expected);
});

test("通识值：输入越多越高（单调）", () => {
  const low = rankValue({ ...ZERO, totalCorrect: 10 });
  const high = rankValue({ ...ZERO, totalCorrect: 11 });
  assert.ok(high > low);
});

test("段位：0 值落在第一段「见习」", () => {
  const r = computeRank(ZERO);
  assert.equal(r.tier, 0);
  assert.equal(r.tierName, RANK_TIERS[0].name);
  assert.equal(r.nextThreshold, RANK_TIERS[1].threshold);
  assert.equal(r.nextGap, RANK_TIERS[1].threshold);
  assert.equal(r.progress, 0);
  assert.equal(r.maxed, false);
});

test("段位：恰好到达门槛时进入该段", () => {
  const r = computeRank({ ...ZERO, totalCorrect: RANK_TIERS[1].threshold / RANK_WEIGHTS.correct });
  assert.equal(r.tier, 1);
  assert.equal(r.tierName, RANK_TIERS[1].name);
  // nextGap 指的是**距离下一段**还差多少，不是刚晋级的这一段
  assert.equal(r.nextThreshold, RANK_TIERS[2].threshold);
  assert.equal(r.nextGap, RANK_TIERS[2].threshold - RANK_TIERS[1].threshold);
});

test("段位：门槛 -1 时仍在上一段", () => {
  const r = computeRank({
    ...ZERO,
    totalCorrect: (RANK_TIERS[1].threshold - 1) / RANK_WEIGHTS.correct,
  });
  assert.equal(r.tier, 0);
  assert.equal(r.nextGap, 1);
});

test("段位：进度恒在 [0,1]，且同一段内单调不减", () => {
  let prevTier = -1;
  let prevProgress = -1;
  for (let i = 0; i < 60; i++) {
    const r = computeRank({ ...ZERO, totalCorrect: i * 5 });
    assert.ok(r.progress >= 0 && r.progress <= 1, `progress out of range: ${r.progress}`);
    if (r.tier === prevTier) {
      assert.ok(r.progress >= prevProgress, "同一段内进度必须单调不减");
    }
    prevTier = r.tier;
    prevProgress = r.progress;
  }
});

test("段位：晋级瞬间进度归零重来（进度是段内进度，不是全局进度）", () => {
  const justBefore = computeRank({
    ...ZERO,
    totalCorrect: (RANK_TIERS[1].threshold - 1) / RANK_WEIGHTS.correct,
  });
  const justAfter = computeRank({
    ...ZERO,
    totalCorrect: RANK_TIERS[1].threshold / RANK_WEIGHTS.correct,
  });
  assert.equal(justBefore.tier, 0);
  assert.equal(justAfter.tier, 1);
  assert.ok(justBefore.progress > 0.9, "晋级前应接近满");
  assert.equal(justAfter.progress, 0, "晋级后进度归零");
});

test("段位：满级后 nextThreshold 为 null、progress 为 1", () => {
  const r = computeRank({ ...ZERO, totalCorrect: 999999 });
  assert.equal(r.maxed, true);
  assert.equal(r.nextThreshold, null);
  assert.equal(r.nextGap, 0);
  assert.equal(r.progress, 1);
  assert.equal(r.tier, RANK_TIERS.length - 1);
});

test("段位：门槛严格递增且从 0 起", () => {
  assert.equal(RANK_TIERS[0].threshold, 0);
  for (let i = 1; i < RANK_TIERS.length; i++) {
    assert.ok(RANK_TIERS[i].threshold > RANK_TIERS[i - 1].threshold);
    assert.equal(RANK_TIERS[i].index, i);
  }
});

test("熟练度统计：只数非零项，且只认 `domain|topic` 形态的键", () => {
  const m = {
    "gaming|经典作品": 3,
    "anime|声优": 0,
    "tech|航天": -1,
    malformed: 5,
  };
  // 非零：gaming(+3)、tech(-1) → 2 项；anime 为 0 不计；malformed 键形态不对不计
  assert.equal(countTopicsTouched(m), 2);
});

test("生涯汇总：答对数/局数/星级/最高连击", () => {
  const t = totalsFromHistory([
    { correct: 4, stars: 2, maxCombo: 3 },
    { correct: 3, stars: 1, maxCombo: 5 },
    { correct: 5, stars: 3, maxCombo: 1 },
  ]);
  assert.equal(t.totalCorrect, 12);
  assert.equal(t.totalPlayed, 3);
  assert.equal(t.totalStars, 6);
  assert.equal(t.bestCombo, 5);
});

test("生涯汇总：空历史不炸", () => {
  const t = totalsFromHistory([]);
  assert.equal(t.totalPlayed, 0);
  assert.equal(t.bestCombo, 0);
});

test("领域集合键：与输入顺序无关", () => {
  assert.equal(domainSetKey(["gaming", "anime"]), domainSetKey(["anime", "gaming"]));
});

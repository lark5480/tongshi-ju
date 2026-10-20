import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BASE_POINTS,
  blitzFactor,
  comboMultiplier,
  decideWinner,
  maxScore,
  nextCombo,
  roundPoints,
  speedFactor,
  starRating,
} from "../lib/engine/scoring";

test("速度系数落在 [0.5, 1.0]，越快越高", () => {
  assert.equal(speedFactor(0, 30000), 1);
  assert.equal(speedFactor(30000, 30000), 0.5);
  assert.equal(speedFactor(15000, 30000), 0.75);
  const fast = speedFactor(1000, 30000);
  const slow = speedFactor(20000, 30000);
  assert.ok(fast > slow);
});

test("速度系数对超时不产生负值", () => {
  assert.equal(speedFactor(999999, 30000), 0.5);
});

test("速度系数在 limit 为 0 时退化为 0.5", () => {
  assert.equal(speedFactor(100, 0), 0.5);
});

test("秒答加成：前 1/3 时间内 ×1.2", () => {
  assert.equal(blitzFactor(10000, 30000), 1.2);
  assert.equal(blitzFactor(10001, 30000), 1);
  assert.equal(blitzFactor(0, 30000), 1.2);
});

test("连击倍率曲线：0-1 → 1.0，2-3 → 1.05，4-5 → 1.1，6+ → 1.2 封顶", () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.05);
  assert.equal(comboMultiplier(3), 1.05);
  assert.equal(comboMultiplier(4), 1.1);
  assert.equal(comboMultiplier(5), 1.1);
  assert.equal(comboMultiplier(6), 1.2);
  assert.equal(comboMultiplier(99), 1.2);
});

test("单题得分 = 基础分 × 速度 × 秒答 × 连击", () => {
  // 难度 2（20 分），立刻作答 → 速度 1.0、秒答 1.2、连击 1.0
  assert.equal(roundPoints(2, 0, 25000, 0), Math.round(20 * 1 * 1.2));
  // 加了连击倍率
  assert.equal(roundPoints(2, 0, 25000, 6), Math.round(20 * 1 * 1.2 * 1.2));
  // 慢答无秒答
  assert.equal(roundPoints(1, 20000, 30000, 0), Math.round(10 * speedFactor(20000, 30000)));
});

test("基础分随难度递增", () => {
  assert.equal(BASE_POINTS[1], 10);
  assert.equal(BASE_POINTS[2], 20);
  assert.equal(BASE_POINTS[3], 30);
});

test("星级映射：≥60% 三星，≥35% 两星，其余一星", () => {
  assert.equal(starRating(60, 100), 3);
  assert.equal(starRating(59.9, 100), 2);
  assert.equal(starRating(35, 100), 2);
  assert.equal(starRating(34.9, 100), 1);
  assert.equal(starRating(0, 100), 1);
  assert.equal(starRating(10, 0), 1);
});

test("maxScore 按难度累加", () => {
  assert.equal(maxScore([1, 1, 2, 2, 3]), (10 + 10 + 20 + 20 + 30) * 1 * 1.2 * 1.2);
});

test("跨域连击：跨域 +1，同域不增不减，失败归零", () => {
  assert.equal(nextCombo(0, true, null, "gaming"), 1, "首次抢先答对 → 1");
  assert.equal(nextCombo(1, true, "gaming", "tech"), 2, "跨域 → 增长");
  assert.equal(nextCombo(3, true, "tech", "tech"), 3, "同域 → 保持不变");
  assert.equal(nextCombo(3, false, "tech", "tech"), 0, "失败 → 归零");
});

test("decideWinner：先比总分，再比抢先答对数，全同则平局", () => {
  assert.equal(decideWinner({ a: 100, b: 50 }, { a: 2, b: 5 }), "a");
  assert.equal(decideWinner({ a: 100, b: 100 }, { a: 3, b: 1 }), "a");
  assert.equal(decideWinner({ a: 100, b: 100 }, { a: 2, b: 2 }), null);
  assert.equal(decideWinner({}, {}), null);
  assert.equal(decideWinner({ a: 10 }, { a: 0 }), "a");
});

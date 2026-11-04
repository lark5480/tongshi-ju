/**
 * 计分口径版本（v1 / v2）与加练题埋点 · 单元测试
 *
 * 覆盖两件事：
 * 1. 旧记录（5 题计分）不参与 v2 排名类计算，且**不重算、不补齐**；
 * 2. 加练题只记熟练度：三态埋点可查，但不改变分数 / 连击 / 排名。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { DailySession, DomainId, HistoryEntry } from "../types";
import { computeRank } from "../lib/engine/rank";
import {
  SCORING_VERSION,
  lifetimeForVersion,
  normalizeLifetimeStore,
  scoringVersionOf,
  settlePublicAnswers,
} from "../lib/engine/scoring";
import {
  ghostVersionOf,
  isGhostComparable,
  updateGhost,
  type GhostRecord,
} from "../lib/engine/ghost";
import {
  bumpLifetimeStats,
  getLifetimeStats,
  getMastery,
  getPracticeFunnel,
  getPracticeFunnelSummary,
  getRankSnapshot,
  markPracticeResultSeen,
  recordAttempt,
  removeKey,
  saveDailySession,
  updatePracticeFunnel,
} from "../lib/storage";

// ---------------------------------------------------------------- 口径版本

test("口径版本：缺失字段的旧记录按 v1，新记录才标 v2", () => {
  const legacy: HistoryEntry = {
    date: "2026-10-01",
    domains: ["gaming"],
    score: 120,
    correct: 4,
    total: 5,
    stars: 3,
    maxCombo: 2,
    mode: "daily",
  };
  const current: HistoryEntry = {
    ...legacy,
    date: "2026-11-04",
    total: 4,
    scoringVersion: SCORING_VERSION,
  };
  assert.equal(scoringVersionOf(legacy), 1, "旧记录没有字段 → v1（5 题）");
  assert.equal(scoringVersionOf(current), 2, "新记录显式标 v2（4 题）");
});

test("口径版本：旧扁平生涯数据归入 v1，不参与 v2 统计", () => {
  // 旧版本写的是扁平 bucket —— 它不是"坏数据"，就是 v1 的生涯累计。
  const store = normalizeLifetimeStore({
    totalCorrect: 8,
    totalPlayed: 4,
    totalStars: 12,
    bestCombo: 5,
  });
  assert.equal(lifetimeForVersion(store, 1).totalCorrect, 8, "旧扁平数据 = v1");
  assert.equal(lifetimeForVersion(store, 1).totalPlayed, 4);
  assert.equal(lifetimeForVersion(store, 2).totalCorrect, 0, "v2 不继承旧口径");
  assert.equal(lifetimeForVersion(store, 2).totalPlayed, 0);
});

test("口径版本：v1 / v2 生涯桶各自累加互不影响", () => {
  removeKey("lifetime");
  bumpLifetimeStats({ correct: 3, stars: 4, maxCombo: 2 }, 1);
  bumpLifetimeStats({ correct: 2, stars: 5, maxCombo: 3 }, 2);

  const v1 = getLifetimeStats(1);
  const v2 = getLifetimeStats(2);
  assert.equal(v1.totalCorrect, 3);
  assert.equal(v1.totalPlayed, 1);
  assert.equal(v2.totalCorrect, 2);
  assert.equal(v2.totalPlayed, 1);
  assert.equal(v2.totalStars, 5);
  assert.equal(v2.bestCombo, 3);
});

test("口径版本：段位只用同版本（v2）生涯数据", () => {
  removeKey("lifetime");
  removeKey("mastery");
  removeKey("streak");
  // 旧口径给一份很漂亮的生涯数据 —— 段位不能被它抬高。
  bumpLifetimeStats({ correct: 999, stars: 999, maxCombo: 99 }, 1);

  const baseline = computeRank({
    totalCorrect: 0,
    totalPlayed: 0,
    totalStars: 0,
    topicsTouched: 0,
    bestCombo: 0,
    bestStreak: 0,
  });
  const snapshot = getRankSnapshot();
  assert.equal(snapshot.tierName, baseline.tierName, "旧口径不参与段位");
  assert.equal(snapshot.progress, baseline.progress);
});

test("口径版本：影子跨口径不可比，更新时重新起算", () => {
  const key = "gaming+tech";
  const v1Ghost: GhostRecord = {
    key,
    bestScore: 120,
    bestCorrect: 5,
    bestDate: "2026-10-01",
    plays: 3,
    bestElapsed: null,
  };

  assert.equal(ghostVersionOf(v1Ghost), 1, "旧影子缺失字段 → v1");
  assert.equal(isGhostComparable(v1Ghost, 2), false, "v1 影子不能当 v2 基准");

  const updated = updateGhost(v1Ghost, {
    key,
    score: 40,
    correct: 4,
    date: "2026-11-04",
    elapsed: 30,
    scoringVersion: 2,
  });
  assert.equal(updated.scoringVersion, 2);
  assert.equal(updated.plays, 1, "跨口径不继承旧局数");
  assert.equal(updated.bestScore, 40, "跨口径不继承旧最高分");
});

// ---------------------------------------------------------------- 4+1 计分

test("4+1 计分：第 5 题答对/答错都不改变分数与连击", () => {
  const publicAnswers = [
    { correct: true, points: 10, combo: 1 },
    { correct: true, points: 20, combo: 2 },
    { correct: false, points: 0, combo: 0 },
    { correct: true, points: 30, combo: 1 },
  ];
  const base = settlePublicAnswers(publicAnswers);
  assert.equal(base.score, 60);
  assert.equal(base.correct, 3);
  assert.equal(base.maxCombo, 2);

  // 加练题即使答对也不给分（submit 里 points 恒为 0），连击也不参与。
  const withCorrectPractice = settlePublicAnswers([
    ...publicAnswers,
    { correct: true, points: 0, combo: 1, practice: true },
  ]);
  const withWrongPractice = settlePublicAnswers([
    ...publicAnswers,
    { correct: false, points: 0, combo: 1, practice: true },
  ]);
  assert.deepEqual(withCorrectPractice, base, "加练题答对不改变分数/答对/连击");
  assert.deepEqual(withWrongPractice, base, "加练题答错不改变分数/答对/连击");
});

test("加练题答对：熟练度 +1，但分数仍按前 4 题计算", () => {
  removeKey("mastery");
  removeKey("wrong");
  const topic = "T1";
  const domain = "gaming" as DomainId;
  recordAttempt({ questionId: "practice-1", domain, topic, correct: true });
  const mastery = getMastery()[`${domain}|${topic}`];
  assert.equal(mastery, 1, "答对加练题写熟练度 +1");

  const answers = [
    { correct: true, points: 10, combo: 1 },
    { correct: true, points: 20, combo: 2 },
    { correct: true, points: 20, combo: 2 },
    { correct: true, points: 30, combo: 1 },
    { correct: true, points: 0, combo: 1, practice: true },
  ];
  assert.equal(settlePublicAnswers(answers).score, 80, "第 5 题不进分数");
});

// ---------------------------------------------------------------- 加练埋点

function session(date: string, over: Partial<DailySession> = {}): DailySession {
  return {
    date,
    domains: ["gaming"],
    questionIds: ["q1", "q2", "q3", "q4", "q5"],
    done: false,
    mode: "native",
    practiceReason: "你在科技错了 3 次，今天补一题",
    practiceFunnel: { shown: true, answered: false, correct: false, resultSeen: false },
    ...over,
  };
}

test("加练埋点：展示 → 作答 → 正确 三态写入当日会话", () => {
  const date = "2026-11-10";
  removeKey(`daily.${date}`);
  saveDailySession(session(date));

  assert.deepEqual(getPracticeFunnel(date), {
    shown: true,
    answered: false,
    correct: false,
    resultSeen: false,
  });

  updatePracticeFunnel(date, { answered: true, correct: true });
  assert.deepEqual(getPracticeFunnel(date), {
    shown: true,
    answered: true,
    correct: true,
    resultSeen: false,
  });

  // 旧会话没有 practiceFunnel 字段 → 用 practiceReason / practiceCorrect 推断。
  const legacyDate = "2026-11-13";
  removeKey(`daily.${legacyDate}`);
  saveDailySession(session(legacyDate, { practiceFunnel: undefined, practiceCorrect: true }));
  assert.deepEqual(getPracticeFunnel(legacyDate), {
    shown: true,
    answered: true,
    correct: true,
    resultSeen: false,
  });

  removeKey(`daily.${date}`);
  removeKey(`daily.${legacyDate}`);
});

test("加练埋点：结算页曝光单独记 resultSeen", () => {
  const date = "2026-11-11";
  removeKey(`daily.${date}`);
  saveDailySession(
    session(date, {
      practiceFunnel: { shown: true, answered: true, correct: true, resultSeen: false },
    })
  );
  markPracticeResultSeen(date);
  assert.deepEqual(getPracticeFunnel(date), {
    shown: true,
    answered: true,
    correct: true,
    resultSeen: true,
  });
  removeKey(`daily.${date}`);
});

test("加练埋点：按日期区间汇总展示数 / 作答率 / 正确率", () => {
  const dates = ["2026-11-10", "2026-11-11", "2026-11-12"];
  for (const d of dates) removeKey(`daily.${d}`);

  // 11-10：展示 + 作答 + 正确；11-11：只展示；11-12：没有会话。
  saveDailySession(
    session("2026-11-10", {
      practiceFunnel: { shown: true, answered: true, correct: true, resultSeen: true },
    })
  );
  saveDailySession(
    session("2026-11-11", {
      practiceFunnel: { shown: true, answered: false, correct: false, resultSeen: false },
    })
  );

  const summary = getPracticeFunnelSummary("2026-11-10", "2026-11-12");
  assert.equal(summary.days, 3);
  assert.equal(summary.shown, 2);
  assert.equal(summary.answered, 1);
  assert.equal(summary.correct, 1);
  assert.equal(summary.resultSeen, 1);
  assert.equal(summary.answerRate, 0.5);
  assert.equal(summary.correctRate, 1);

  for (const d of dates) removeKey(`daily.${d}`);
});

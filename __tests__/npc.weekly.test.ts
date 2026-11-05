/**
 * NPC 周报 · 单元测试
 *
 * 只测纯函数：周界、聚合口径、模板与缓存指纹。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildWeeklyDigest,
  buildWeeklyTemplate,
  weekBounds,
  weeklyFingerprint,
  type WeeklyDigestInput,
} from "../lib/npc/core/weekly";
import type { DomainId } from "../types";

function input(over: Partial<WeeklyDigestInput> = {}): WeeklyDigestInput {
  return {
    weekKey: "2026-11-02",
    from: "2026-11-02",
    to: "2026-11-05",
    sessions: [
      { date: "2026-11-02", done: true, score: 300, correct: 3, scoringVersion: 2 },
      { date: "2026-11-03", done: true, score: 400, correct: 4, scoringVersion: 2 },
      { date: "2026-11-04", done: false, scoringVersion: 2 },
      // v1（旧口径 5 题）不混入
      { date: "2026-11-05", done: true, score: 999, correct: 5, scoringVersion: 1 },
    ],
    episodes: [
      { domain: "gaming" as DomainId, correct: false },
      { domain: "gaming" as DomainId, correct: false },
      { domain: "gaming" as DomainId, correct: true },
      { domain: "tech" as DomainId, correct: true },
      // 加练题不计入薄弱域
      { domain: "gaming" as DomainId, correct: false, source: "practice" as const },
    ],
    practice: { shown: 3, answered: 2, correct: 1, skipped: 1 },
    ...over,
  };
}

test("周界：周一起算，周日仍归本周", () => {
  assert.deepEqual(weekBounds("2026-11-05"), {
    weekKey: "2026-11-02",
    from: "2026-11-02",
    to: "2026-11-05",
  });
  assert.deepEqual(weekBounds("2026-11-08"), {
    weekKey: "2026-11-02",
    from: "2026-11-02",
    to: "2026-11-08",
  });
});

test("周界：跨年周用周一日期，不用 ISO 周号", () => {
  assert.deepEqual(weekBounds("2027-01-01"), {
    weekKey: "2026-12-28",
    from: "2026-12-28",
    to: "2027-01-01",
  });
});

test("周界：非法日期原样返回，不崩", () => {
  assert.deepEqual(weekBounds("bad"), { weekKey: "bad", from: "bad", to: "bad" });
});

test("聚合：只算完成的 v2 每日挑战，加练不计入薄弱域", () => {
  const digest = buildWeeklyDigest(input());
  assert.equal(digest.sessions, 2);
  assert.equal(digest.answered, 8);
  assert.equal(digest.correct, 7);
  assert.equal(digest.accuracy, 0.875);
  assert.equal(digest.scoreTotal, 700);
  assert.equal(digest.bestScore, 400);
  assert.equal(digest.activeDays, 2);
  assert.equal(digest.practice.answered, 2);

  const gaming = digest.domains.find((d) => d.domain === "gaming");
  assert.deepEqual(gaming, { domain: "gaming", attempts: 3, wrongs: 2 });
  assert.equal(digest.weakestDomain, "gaming");
});

test("模板：点名最弱域与加练表现", () => {
  const text = buildWeeklyTemplate(buildWeeklyDigest(input()));
  assert.ok(text.includes("本周完成 2 次每日挑战"));
  assert.ok(text.includes("答对 7/8 题（88%）"), text);
  assert.ok(text.includes("「游戏」错得最多（2 次）"), text);
  assert.ok(text.includes("加练题作答 2 天，跳过 1 天"), text);
});

test("模板：空周给出可执行提示", () => {
  const digest = buildWeeklyDigest(
    input({
      sessions: [],
      episodes: [],
      practice: { shown: 0, answered: 0, correct: 0, skipped: 0 },
    })
  );
  assert.equal(digest.sessions, 0);
  assert.ok(buildWeeklyTemplate(digest).includes("本周还没开始"));
});

test("指纹：顺序无关，数据变化才变", () => {
  const base = buildWeeklyDigest(input());
  const reordered = buildWeeklyDigest({
    ...input(),
    episodes: [...input().episodes].reverse(),
    sessions: [...input().sessions].reverse(),
  });
  assert.equal(weeklyFingerprint(base), weeklyFingerprint(reordered));

  const changed = buildWeeklyDigest(
    input({
      episodes: [
        { domain: "gaming" as DomainId, correct: true },
        { domain: "gaming" as DomainId, correct: true },
        { domain: "gaming" as DomainId, correct: true },
      ],
    })
  );
  assert.notEqual(weeklyFingerprint(base), weeklyFingerprint(changed));
});

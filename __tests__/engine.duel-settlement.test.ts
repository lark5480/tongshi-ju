import { test } from "node:test";
import assert from "node:assert/strict";

import type { PublicPlayer, RoomSnapshot, RoundRecord } from "@/types";
import { buildDuelSettlement } from "@/lib/engine/duel-settlement";

/**
 * duel 结算纯函数的不变量：
 * - 只有已结束且有回合记录的对局才产出结算；
 * - 只结算本人**实际作答过**的回合；
 * - history 的字段全部来自服务端权威快照，不依赖当前时间。
 */

function player(slot: 0 | 1, maxCombo: number): PublicPlayer {
  return {
    slot,
    name: slot === 0 ? "房主" : "访客",
    emoji: "🧠",
    ready: false,
    connected: true,
    score: 0,
    combo: 0,
    firstCorrect: 0,
    maxCombo,
  };
}

const RECORD_0: RoundRecord = {
  roundIndex: 0,
  domain: "gaming",
  topic: "主机游戏",
  questionId: "gaming-0001",
  correctAnswer: "A",
  explanation: "解析 0",
  winnerSlot: 0,
  elapsed: { "0": 4_000, "1": null },
  correct: { "0": true, "1": false },
  points: { "0": 24, "1": 0 },
  tie: false,
};

const RECORD_1: RoundRecord = {
  roundIndex: 1,
  domain: "tech",
  topic: "操作系统",
  questionId: "tech-0001",
  correctAnswer: "B",
  explanation: "解析 1",
  winnerSlot: 1,
  elapsed: { "0": null, "1": 5_000 },
  correct: { "0": false, "1": true },
  points: { "0": 0, "1": 26 },
  tie: false,
};

function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "AB12CD",
    matchId: "AB12CD:12345",
    hostSlot: 0,
    status: "finished",
    domains: ["gaming", "tech"],
    roundIndex: 2,
    questions: [
      {
        id: "gaming-0001",
        domain: "gaming",
        topic: "主机游戏",
        difficulty: 2,
        type: "single",
        stem: "题干 0",
        options: ["A", "B"],
      },
      {
        id: "tech-0001",
        domain: "tech",
        topic: "操作系统",
        difficulty: 2,
        type: "single",
        stem: "题干 1",
        options: ["A", "B"],
      },
    ],
    startedAt: null,
    deadlineAt: null,
    limitMs: 25_000,
    nextAt: null,
    lockedWinnerSlot: null,
    scores: { "0": 50, "1": 26 },
    combos: { "0": 0, "1": 0 },
    players: [player(0, 3), player(1, 1)],
    history: [RECORD_0, RECORD_1],
    serverNow: 0,
    totalRounds: 2,
    ...overrides,
  };
}

test("未结束的对局不结算", () => {
  const plan = buildDuelSettlement(makeSnapshot({ status: "feedback" }), 0, "2026-10-21");
  assert.equal(plan, null);
});

test("没有回合记录不结算", () => {
  const plan = buildDuelSettlement(makeSnapshot({ history: [] }), 0, "2026-10-21");
  assert.equal(plan, null);
});

test("席位不在房间内不结算", () => {
  const plan = buildDuelSettlement(makeSnapshot({ players: [player(0, 3)] }), 1, "2026-10-21");
  assert.equal(plan, null);
});

test("只收本人实际作答过的回合（被抢先 / 未作答不进档案）", () => {
  const plan = buildDuelSettlement(makeSnapshot(), 0, "2026-10-21");
  assert.ok(plan);
  assert.equal(plan!.attempts.length, 1);
  assert.equal(plan!.attempts[0].questionId, "gaming-0001");

  const guestPlan = buildDuelSettlement(makeSnapshot(), 1, "2026-10-21");
  assert.ok(guestPlan);
  assert.equal(guestPlan!.attempts.length, 1);
  assert.equal(guestPlan!.attempts[0].questionId, "tech-0001");
});

test("答对 / 答错 / 未作答分别映射为 correct 布尔值", () => {
  const history: RoundRecord[] = [
    RECORD_0,
    RECORD_1,
    {
      ...RECORD_1,
      roundIndex: 2,
      questionId: "tech-0002",
      elapsed: { "0": 6_000, "1": null },
      correct: { "0": false, "1": false },
      winnerSlot: null,
    },
  ];
  const plan = buildDuelSettlement(makeSnapshot({ history }), 0, "2026-10-21");
  assert.ok(plan);
  assert.deepEqual(
    plan!.attempts.map((a) => [a.questionId, a.correct]),
    [
      ["gaming-0001", true],
      ["tech-0002", false],
    ]
  );
  assert.equal(plan!.history.correct, 1, "只有答对的回合计入 correct");
  assert.equal(plan!.history.total, 3, "total 是全场回合数，不是本人作答数");
});

test("history 字段来自权威快照，matchId 原样透传", () => {
  const plan = buildDuelSettlement(makeSnapshot(), 0, "2026-10-21");
  assert.ok(plan);
  assert.equal(plan!.matchId, "AB12CD:12345");
  assert.deepEqual(plan!.history, {
    date: "2026-10-21",
    domains: ["gaming", "tech"],
    score: 50,
    correct: 1,
    total: 2,
    stars: 3,
    maxCombo: 3,
    mode: "duel",
    roomCode: "AB12CD",
  });
});

test("maxCombo 取本人快照字段，不取对手", () => {
  const plan = buildDuelSettlement(makeSnapshot(), 1, "2026-10-21");
  assert.ok(plan);
  assert.equal(plan!.history.maxCombo, 1);
});

test("stars 随分数变化（同一题集下低分星级更低）", () => {
  const high = buildDuelSettlement(makeSnapshot({ scores: { "0": 50, "1": 0 } }), 0, "2026-10-21");
  const low = buildDuelSettlement(makeSnapshot({ scores: { "0": 5, "1": 0 } }), 0, "2026-10-21");
  assert.ok(high && low);
  assert.equal(high!.history.stars, 3);
  assert.equal(low!.history.stars, 1);
});

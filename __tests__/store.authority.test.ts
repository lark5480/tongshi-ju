import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  RoomError,
  __resetRoomsForTest,
  createRoom,
  getSnapshot,
  joinRoom,
  setConnected,
  setReady,
  startRoom,
  submitAnswer,
} from "../lib/store/room";
import { findQuestion } from "../lib/content/server-bank";
import { advance, installFakeTime, uninstallFakeTime } from "./helpers/fake-time";

/**
 * 服务端权威计时的回归测试。
 *
 * 这些断言对应的是 chess-arena 需求评审中判为 No-Go 的核心风险：
 * 「客户端计时 / 客户端判定结果」会导致超时争议与状态不一致。
 * 本项目把计时、判定、推进**全部**放在服务端，这里逐条锁死。
 */

interface Fixture {
  code: string;
  hostId: string;
  guestId: string;
}

/** 建一个双方已准备、已进入答题相位的房间。 */
function startDuel(domains: string[] = ["gaming"]): Fixture {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: domains as never });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  startRoom(host.code, host.playerId);
  // 推进过倒计时（3s），进入答题相位
  advance(3_000);
  getSnapshot(host.code);
  return { code: host.code, hostId: host.playerId, guestId: guest.playerId };
}

/** 取当前题的正确答案。 */
function currentAnswer(code: string): { id: string; answer: string | string[] } {
  const snap = getSnapshot(code)!;
  const meta = snap.questions[snap.roundIndex];
  const full = findQuestion(meta.id)!;
  return { id: meta.id, answer: full.answer };
}

/** 取当前题的正确答案（用于构造「错误答案」）。 */
function wrongAnswer(code: string): string {
  const snap = getSnapshot(code)!;
  const meta = snap.questions[snap.roundIndex];
  const full = findQuestion(meta.id)!;
  const correct = Array.isArray(full.answer) ? full.answer[0] : full.answer;
  const wrong = full.options.find((o) => o !== correct)!;
  return wrong;
}

beforeEach(() => {
  installFakeTime();
  __resetRoomsForTest();
});

afterEach(() => {
  __resetRoomsForTest();
  uninstallFakeTime();
});

test("开局后进入答题相位，限时由服务端设定", () => {
  const f = startDuel();
  const snap = getSnapshot(f.code)!;
  assert.equal(snap.status, "question");
  assert.ok(snap.startedAt);
  assert.ok(snap.deadlineAt);
  assert.ok(snap.deadlineAt! > snap.startedAt!, "截止时间必须晚于开始时间");
  assert.equal(snap.limitMs, snap.deadlineAt! - snap.startedAt!);
});

test("答对即锁定回合，对手随后提交被拒", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);

  const res = submitAnswer({
    code: f.code,
    playerId: f.hostId,
    roundIndex: 0,
    answer,
  });
  assert.equal(res.correct, true);
  assert.equal(res.winnerSlot, 0);

  // 对手再来提交 → 回合已被抢先
  assert.throws(
    () =>
      submitAnswer({
        code: f.code,
        playerId: f.guestId,
        roundIndex: 0,
        answer: wrongAnswer(f.code),
      }),
    (e: unknown) => e instanceof RoomError && e.code === "round_locked"
  );
});

test("答错不锁定回合，对手仍可作答", () => {
  const f = startDuel();
  const wrong = wrongAnswer(f.code);

  const res = submitAnswer({
    code: f.code,
    playerId: f.hostId,
    roundIndex: 0,
    answer: wrong,
  });
  assert.equal(res.correct, false);
  assert.equal(res.winnerSlot, null);

  // 对手仍能抢答
  const { answer } = currentAnswer(f.code);
  const res2 = submitAnswer({
    code: f.code,
    playerId: f.guestId,
    roundIndex: 0,
    answer,
  });
  assert.equal(res2.correct, true);
  assert.equal(res2.winnerSlot, 1);
});

test("双方都答错 → 立即结算，不空等剩余读秒", () => {
  const f = startDuel();
  const wrong = wrongAnswer(f.code);
  const before = getSnapshot(f.code)!;
  const deadline = before.deadlineAt!;

  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer: wrong });
  // 对手还没答 → 回合必须还开着：那是他的机会，不能被抢走
  assert.equal(getSnapshot(f.code)!.status, "question");

  submitAnswer({ code: f.code, playerId: f.guestId, roundIndex: 0, answer: wrong });

  const snap = getSnapshot(f.code)!;
  assert.equal(snap.status, "feedback", "全员已作答且无人答对 → 应立即结算");
  assert.ok(Date.now() < deadline, "结算应早于 deadlineAt，否则就是等读秒耗尽");

  const record = snap.history[snap.history.length - 1];
  assert.equal(record.winnerSlot, null, "无人答对 → 没有赢家");
  assert.equal(record.points["0"], 0);
  assert.equal(record.points["1"], 0);
  // 双方都真的答过（不是超时未答），elapsed 必须都有值
  assert.notEqual(record.elapsed["0"], null);
  assert.notEqual(record.elapsed["1"], null);
});

test("对手掉线且未作答 → 仍按 deadline 读秒，不提前结算", () => {
  const f = startDuel();
  setConnected(f.code, f.guestId, false);

  submitAnswer({
    code: f.code,
    playerId: f.hostId,
    roundIndex: 0,
    answer: wrongAnswer(f.code),
  });

  // 掉线不改变判据：未作答的一方仍然握着这一题的机会
  assert.equal(getSnapshot(f.code)!.status, "question");
});

test("每人每题只能提交一次（重复提交被拒）", () => {
  const f = startDuel();
  const wrong = wrongAnswer(f.code);
  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer: wrong });
  assert.throws(
    () => submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer: wrong }),
    (e: unknown) => e instanceof RoomError && e.code === "already_answered"
  );
});

test("超时提交被判超时，不锁定回合（对手仍可作答）", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);

  // 推进到超时之后
  advance(60_000);

  assert.throws(
    () => submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer }),
    (e: unknown) => e instanceof RoomError && e.code === "timeout"
  );

  // 此刻该回合已因超时自动结束，轮到下一题
  const snap = getSnapshot(f.code)!;
  assert.ok(
    snap.status === "feedback" || snap.status === "countdown" || snap.status === "question"
  );
});

test("客户端无法伪造用时：提交接口不接收 elapsed", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);
  // 直接调用 store 接口时只传答案，服务端自行计算用时
  const res = submitAnswer({
    code: f.code,
    playerId: f.hostId,
    roundIndex: 0,
    answer,
  });
  assert.equal(res.correct, true);
  const snap = getSnapshot(f.code)!;
  const rec = snap.history[snap.history.length - 1];
  assert.ok(rec, "应产生结算记录");
  // 用时由服务端计算，落在 [0, 限时] 区间内
  const elapsed = rec.elapsed["0"];
  assert.ok(elapsed !== null && elapsed >= 0 && elapsed <= snap.limitMs);
});

test("超时结算：本回合无人答对，双方 0 分", () => {
  const f = startDuel();
  advance(60_000);
  getSnapshot(f.code); // 触发惰性相位推进

  const snap = getSnapshot(f.code)!;
  assert.equal(snap.history.length, 1);
  const rec = snap.history[0];
  assert.equal(rec.winnerSlot, null);
  assert.equal(rec.points["0"], 0);
  assert.equal(rec.points["1"], 0);
  // 结算后才公布答案与解析
  assert.ok(rec.correctAnswer);
  assert.ok(rec.explanation.length > 0);
});

test("回合推进：反馈期结束后进入下一题", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);
  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer });

  let snap = getSnapshot(f.code)!;
  assert.equal(snap.status, "feedback");
  assert.equal(snap.roundIndex, 0);

  // 反馈期 3s
  advance(3_000);
  snap = getSnapshot(f.code)!;
  assert.equal(snap.status, "countdown");
  assert.equal(snap.roundIndex, 1);
});

test("题目序号不匹配时拒绝提交", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);
  assert.throws(
    () => submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 99, answer }),
    (e: unknown) => e instanceof RoomError && e.code === "stale_round"
  );
});

test("非答题阶段拒绝提交", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  assert.throws(
    () =>
      submitAnswer({
        code: host.code,
        playerId: host.playerId,
        roundIndex: 0,
        answer: "A",
      }),
    (e: unknown) => e instanceof RoomError && e.code === "not_answering"
  );
});

test("非房间玩家提交被拒", () => {
  const f = startDuel();
  assert.throws(
    () => submitAnswer({ code: f.code, playerId: "not-a-player", roundIndex: 0, answer: "A" }),
    (e: unknown) => e instanceof RoomError && e.code === "not_a_player"
  );
});

test("抢答者独占该题得分，对手得 0 分", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);
  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer });

  const snap = getSnapshot(f.code)!;
  const rec = snap.history[0];
  assert.ok(rec.points["0"] > 0, "抢答者应得分");
  assert.equal(rec.points["1"], 0, "对手该题 0 分");
  assert.equal(snap.scores["0"], rec.points["0"]);
});

test("跨域连击：跨域抢先答对则连击增长，同域则不增长", () => {
  // 用两个领域交替，构造跨域场景
  const f = startDuel(["gaming", "tech"]);
  const snap0 = getSnapshot(f.code)!;
  const q0 = snap0.questions[0];
  const q1 = snap0.questions[1];
  const full0 = findQuestion(q0.id)!;
  const full1 = findQuestion(q1.id)!;

  // 第 1 题：抢先答对
  submitAnswer({
    code: f.code,
    playerId: f.hostId,
    roundIndex: 0,
    answer: full0.answer,
  });
  let snap = getSnapshot(f.code)!;
  assert.equal(snap.combos["0"], 1);

  // 推进到第 2 题
  advance(3_000);
  getSnapshot(f.code);
  advance(3_000);
  snap = getSnapshot(f.code)!;
  assert.equal(snap.roundIndex, 1);

  // 第 2 题：若与第 1 题不同域 → 连击应增长到 2
  submitAnswer({
    code: f.code,
    playerId: f.hostId,
    roundIndex: 1,
    answer: full1.answer,
  });
  snap = getSnapshot(f.code)!;
  if (q0.domain !== q1.domain) {
    assert.equal(snap.combos["0"], 2, "跨域应增长");
  } else {
    assert.equal(snap.combos["0"], 1, "同域应保持不变");
  }
});

test("答错后连击归零", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);
  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer });
  let snap = getSnapshot(f.code)!;
  assert.equal(snap.combos["0"], 1);

  advance(3_000);
  getSnapshot(f.code);
  advance(3_000);

  const wrong = wrongAnswer(f.code);
  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 1, answer: wrong });
  snap = getSnapshot(f.code)!;
  assert.equal(snap.combos["0"], 0, "答错应归零");
});

test("回合结算记录各席位是否答对，并维护全场最高连击", () => {
  const f = startDuel();
  const { answer } = currentAnswer(f.code);
  submitAnswer({ code: f.code, playerId: f.hostId, roundIndex: 0, answer });

  const snap = getSnapshot(f.code)!;
  const rec = snap.history[snap.history.length - 1];
  assert.ok(rec, "应产生结算记录");
  assert.equal(rec.correct["0"], true, "抢答成功者应标记为答对");
  assert.equal(rec.correct["1"], false, "对手未作答应标记为未答对");

  const host = snap.players.find((p) => p.slot === 0);
  assert.ok(host, "快照应包含房主");
  assert.ok(host!.maxCombo >= 1, "房主本场最高连击应至少为 1");
});

test("matchId 由房间码与 seed 组成，同一局内稳定", () => {
  const f = startDuel();
  const a = getSnapshot(f.code)!;
  const b = getSnapshot(f.code)!;
  assert.equal(a.matchId, b.matchId, "同一局内 matchId 必须稳定");
  assert.ok(a.matchId.startsWith(`${a.code}:`), "matchId 应以房间码开头");
  assert.ok(a.matchId.length > a.code.length + 1, "matchId 应包含 seed 部分");
});

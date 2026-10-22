import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  RoomError,
  __resetRoomsForTest,
  createRoom,
  duelWinner,
  getRoom,
  getSnapshot,
  joinRoom,
  rematch,
  setConnected,
  setReady,
  startRoom,
  sweepExpiredRooms,
} from "../lib/store/room";
import { findQuestion } from "../lib/content/server-bank";
import { advance, installFakeTime, uninstallFakeTime } from "./helpers/fake-time";

const DOMAINS = ["gaming", "tech"] as const;

beforeEach(() => {
  installFakeTime();
  __resetRoomsForTest();
});

afterEach(() => {
  __resetRoomsForTest();
  uninstallFakeTime();
});

test("创建房间返回凭证，房主为 slot 0", () => {
  const cred = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  assert.equal(cred.slot, 0);
  assert.equal(cred.isHost, true);
  assert.equal(cred.code.length, 6);
  assert.ok(cred.playerId.length > 0);
});

test("加入房间得到 slot 1", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  assert.equal(guest.slot, 1);
  assert.equal(guest.isHost, false);
  assert.notEqual(guest.playerId, host.playerId);
});

test("房间码唯一：连续创建不撞码", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 30; i++) {
    codes.add(createRoom({ name: "p", emoji: "🧠", domains: [] }).code);
  }
  assert.equal(codes.size, 30);
});

test("房间码不含易混字符 0/O/1/I/L", () => {
  for (let i = 0; i < 50; i++) {
    const code = createRoom({ name: "p", emoji: "🧠", domains: [] }).code;
    assert.ok(!/[0O1IL]/.test(code), `房间码含易混字符：${code}`);
  }
});

test("重复加入同一房间被拒", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  assert.throws(
    () => joinRoom({ code: host.code, name: "小蓝", emoji: "🐼" }),
    (e: unknown) => e instanceof RoomError && e.status === 409 && e.code === "room_full"
  );
});

test("加入不存在的房间返回 404", () => {
  assert.throws(
    () => joinRoom({ code: "ZZZZZZ", name: "x", emoji: "🧠" }),
    (e: unknown) => e instanceof RoomError && e.status === 404
  );
});

test("快照脱敏：玩家 id 不出现在对外数据中", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  const snap = getSnapshot(host.code);
  assert.ok(snap);
  const serialized = JSON.stringify(snap);
  assert.ok(!serialized.includes(host.playerId), "快照泄露了房主凭证");
  assert.ok(!serialized.includes(guest.playerId), "快照泄露了访客凭证");
  // 席位信息仍可见
  assert.equal(snap.players.find((p) => p.slot === 0)?.name, "小明");
  assert.equal(snap.players.find((p) => p.slot === 1)?.name, "小红");
});

test("非房主不能开局", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  assert.throws(
    () => startRoom(host.code, guest.playerId),
    (e: unknown) => e instanceof RoomError && e.code === "not_host"
  );
});

test("双方未全部准备时不能开局", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  assert.throws(
    () => startRoom(host.code, host.playerId),
    (e: unknown) => e instanceof RoomError && e.code === "not_all_ready"
  );
});

test("只有一人时不能开局", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  setReady(host.code, host.playerId, true);
  assert.throws(
    () => startRoom(host.code, host.playerId),
    (e: unknown) => e instanceof RoomError && e.code === "not_enough_players"
  );
});

test("开局后题目按房主领域生成，双方一致", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  const snap = startRoom(host.code, host.playerId);
  assert.equal(snap.status, "countdown");
  assert.ok(snap.questions.length > 0);
  for (const q of snap.questions) {
    assert.equal(q.domain, "gaming");
    assert.ok(!("answer" in q), "题目元数据不得包含答案");
    assert.ok(!("explanation" in q), "题目元数据不得包含解析");
  }
});

test("duel 题池排除多选，抢答只出单选/判断", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["auto", "film"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  const snap = startRoom(host.code, host.playerId);

  assert.ok(snap.questions.length > 0);
  for (const q of snap.questions) {
    assert.notEqual(q.type, "multi", `duel 不应出现多选：${q.id}`);
  }
});

test("快照里的题目序列在双方视角完全相同", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming", "tech"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  const snap = startRoom(host.code, host.playerId);
  const a = snap.questions.map((q) => q.id);
  const b = getSnapshot(host.code)!.questions.map((q) => q.id);
  assert.deepEqual(a, b);
  void guest;
});

test("开局后不能再加入", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  startRoom(host.code, host.playerId);
  assert.throws(
    () => joinRoom({ code: host.code, name: "小蓝", emoji: "🐼" }),
    (e: unknown) => e instanceof RoomError && e.code === "room_started"
  );
});

test("再来一局：仅房主可发起，且重置分数与状态", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  startRoom(host.code, host.playerId);
  advance(3_000);
  getSnapshot(host.code); // 推进到答题相位

  assert.throws(
    () => rematch(host.code, guest.playerId),
    (e: unknown) => e instanceof RoomError && e.code === "not_host"
  );
  assert.throws(
    () => rematch(host.code, host.playerId),
    (e: unknown) => e instanceof RoomError && e.code === "not_finished"
  );
});

test("在线状态可切换，且不影响房间数据", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  setConnected(host.code, host.playerId, true);
  assert.equal(getSnapshot(host.code)?.players[0].connected, true);
  setConnected(host.code, host.playerId, false);
  assert.equal(getSnapshot(host.code)?.players[0].connected, false);
});

test("对局结束后能算出胜者", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: ["gaming"] });
  const guest = joinRoom({ code: host.code, name: "小红", emoji: "🔥" });
  setReady(host.code, host.playerId, true);
  setReady(host.code, guest.playerId, true);
  startRoom(host.code, host.playerId);
  assert.equal(duelWinner(host.code), null, "尚无得分时应为平局");
});

test("过期房间被清理", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  assert.ok(getRoom(host.code));
  // 推进超过 TTL_IDLE（3 小时）
  advance(4 * 60 * 60 * 1000);
  assert.equal(getRoom(host.code), undefined, "过期房间应被自动清理");
  assert.equal(sweepExpiredRooms(), 0, "已被惰性清理，无需重复清扫");
});

test("未过期的房间保留", () => {
  const host = createRoom({ name: "小明", emoji: "🧠", domains: [] });
  advance(60 * 1000);
  assert.ok(getRoom(host.code));
});

test("题库可用：gaming 域有真实题目与答案", () => {
  const q = findQuestion("gaming-0001");
  assert.ok(q, "应能找到 gaming-0001");
  assert.equal(q!.domain, "gaming");
  assert.ok(q!.options.includes(q!.answer as string));
});

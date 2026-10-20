import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  __resetSubscribersForTest,
  acquireSubscriberSlot,
  addSubscriber,
  broadcast,
  reclaimZombies,
  removeSubscriber,
  roomSubscriberCount,
  totalSubscribers,
} from "../lib/realtime";
import { STREAM_LIMITS } from "../lib/store/constants";
import { __resetRoomsForTest } from "../lib/store/room";

/** 造一个假的 SSE 控制器。 */
function fakeController() {
  const written: string[] = [];
  let closed = false;
  const controller = {
    enqueue(chunk: Uint8Array) {
      written.push(new TextDecoder().decode(chunk));
    },
    close() {
      closed = true;
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, written, isClosed: () => closed };
}

const OPTS = {
  maxPerRoom: STREAM_LIMITS.MAX_SUBSCRIBERS_PER_ROOM,
  maxTotal: STREAM_LIMITS.MAX_TOTAL_SUBSCRIBERS,
  staleMs: STREAM_LIMITS.STALE_SUBSCRIBER_MS,
};

beforeEach(() => {
  __resetRoomsForTest();
  __resetSubscribersForTest();
});

afterEach(() => {
  __resetRoomsForTest();
  __resetSubscribersForTest();
});

test("订阅计数正确增减", () => {
  const a = fakeController();
  const b = fakeController();
  const before = totalSubscribers();
  addSubscriber("ROOM1", a.controller, "p1");
  addSubscriber("ROOM1", b.controller, "p2");
  assert.equal(roomSubscriberCount("ROOM1"), 2);
  assert.equal(totalSubscribers(), before + 2);

  removeSubscriber("ROOM1", a.controller);
  assert.equal(roomSubscriberCount("ROOM1"), 1);
  removeSubscriber("ROOM1", b.controller);
  assert.equal(roomSubscriberCount("ROOM1"), 0);
  assert.equal(totalSubscribers(), before);
});

test("removeSubscriber 幂等：重复移除不会把计数减成负数", () => {
  const a = fakeController();
  const before = totalSubscribers();
  addSubscriber("ROOM1", a.controller, "p1");
  removeSubscriber("ROOM1", a.controller);
  removeSubscriber("ROOM1", a.controller);
  assert.equal(totalSubscribers(), before);
});

test("广播只投递给本房间的订阅者", () => {
  const a = fakeController();
  const b = fakeController();
  const other = fakeController();
  addSubscriber("ROOM1", a.controller, "p1");
  addSubscriber("ROOM1", b.controller, "p2");
  addSubscriber("ROOM2", other.controller, "p3");

  broadcast("ROOM1", {
    type: "countdown",
    roundIndex: 1,
    nextAt: 1000,
  });

  assert.equal(a.written.length, 1);
  assert.equal(b.written.length, 1);
  assert.equal(other.written.length, 0, "不应跨房间投递");
  assert.ok(a.written[0].includes("event: countdown"));
});

test("广播内容不含 playerId 凭证", () => {
  const a = fakeController();
  addSubscriber("ROOM1", a.controller, "p1");
  broadcast("ROOM1", { type: "player_answered", roundIndex: 0, playerSlot: 1 });
  assert.ok(a.written[0].includes('"playerSlot":1'));
  assert.ok(!a.written[0].includes("playerId"), "广播事件不得包含 playerId");
});

test("订阅配额未满时放行", () => {
  assert.equal(acquireSubscriberSlot("ROOM1", "p1", OPTS), "ok");
});

test("超过单房间配额时返回 room-full", () => {
  for (let i = 0; i < STREAM_LIMITS.MAX_SUBSCRIBERS_PER_ROOM; i++) {
    const c = fakeController();
    addSubscriber("ROOM1", c.controller, `p${i}`);
  }
  assert.equal(acquireSubscriberSlot("ROOM1", "p-new", OPTS), "room-full");
});

test("达到配额时先回收僵尸再拒绝（避免重连永远 429）", () => {
  for (let i = 0; i < STREAM_LIMITS.MAX_SUBSCRIBERS_PER_ROOM; i++) {
    const c = fakeController();
    addSubscriber("ROOM1", c.controller, `p${i}`);
  }
  assert.equal(acquireSubscriberSlot("ROOM1", "p-new", OPTS), "room-full");

  // 同一 playerId 的旧连接应被回收
  const removed = reclaimZombies("ROOM1", "p0", STREAM_LIMITS.STALE_SUBSCRIBER_MS);
  assert.equal(removed, 1);
  assert.equal(acquireSubscriberSlot("ROOM1", "p-new", OPTS), "ok");
});

test("超龄订阅被回收", () => {
  const a = fakeController();
  const b = fakeController();
  addSubscriber("ROOM1", a.controller, "p1");
  addSubscriber("ROOM1", b.controller, "p2");
  // staleMs 传 0 → 所有订阅都算超龄
  const removed = reclaimZombies("ROOM1", undefined, 0);
  assert.equal(removed, 2);
  assert.equal(roomSubscriberCount("ROOM1"), 0);
});

test("回收会关闭控制器", () => {
  const a = fakeController();
  addSubscriber("ROOM1", a.controller, "p1");
  reclaimZombies("ROOM1", "p1", STREAM_LIMITS.STALE_SUBSCRIBER_MS);
  assert.equal(a.isClosed(), true);
});

test("全局配额满时返回 global-full", () => {
  // 造满全局配额
  const count = STREAM_LIMITS.MAX_TOTAL_SUBSCRIBERS;
  for (let i = 0; i < count; i++) {
    const c = fakeController();
    addSubscriber(`ROOM${i}`, c.controller, `p${i}`);
  }
  assert.equal(acquireSubscriberSlot("NEWROOM", "p-new", OPTS), "global-full");
});

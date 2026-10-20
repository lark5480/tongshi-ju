/**
 * SSE 订阅管理 —— 房间事件的广播中枢。
 *
 * ## 为什么要有「僵尸回收」
 *
 * 平台（EdgeOne / Vercel）强制掐断连接时，流的 `cancel()` 回调**不保证触发**。
 * 残留的死订阅会一直占着配额，最终表现为「重连永远 429 卡死」。
 * 因此：
 * - 连接配额达上限时**先回收僵尸**（同 playerId 的旧连接、超龄连接）再拒绝；
 * - 服务端在平台超时前**主动优雅关闭**（发 `rotate` → cleanup → close），
 *   把「平台硬杀」变成「清理必然执行」。
 *
 * 存储用 `globalThis` 单例，绕过 Next.js dev HMR 导致的模块重置。
 */

import type { RoomEvent } from "@/types";
import { eventToSse } from "./events";

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  createdAt: number;
  playerId?: string;
}

/** globalThis 单例键。 */
const SUBS_KEY = "__tongshiSubscribers";
const TOTAL_KEY = "__tongshiSubscriberTotal";

type GlobalWithSubs = typeof globalThis & {
  [SUBS_KEY]?: Map<string, Map<ReadableStreamDefaultController<Uint8Array>, Subscriber>>;
  [TOTAL_KEY]?: number;
};

function subsMap(): Map<string, Map<ReadableStreamDefaultController<Uint8Array>, Subscriber>> {
  const g = globalThis as GlobalWithSubs;
  if (!g[SUBS_KEY]) g[SUBS_KEY] = new Map();
  return g[SUBS_KEY]!;
}

function totalCounter(): { get(): number; set(v: number): void } {
  const g = globalThis as GlobalWithSubs;
  if (g[TOTAL_KEY] === undefined) g[TOTAL_KEY] = 0;
  return {
    get: () => g[TOTAL_KEY]!,
    set: (v) => {
      g[TOTAL_KEY] = v;
    },
  };
}

/** 当前全局订阅数。 */
export function totalSubscribers(): number {
  return totalCounter().get();
}

/** 某房间的当前订阅数。 */
export function roomSubscriberCount(code: string): number {
  return subsMap().get(code)?.size ?? 0;
}

export type SlotResult = "ok" | "room-full" | "global-full";

/**
 * 申请一个订阅位。
 *
 * 达到上限时**先回收僵尸**（同 playerId 的旧连接、超龄连接）再判定：
 * 平台掐断残留会让重连永远 429，必须先清理。
 */
export function acquireSubscriberSlot(
  code: string,
  playerId: string | undefined,
  opts: { maxPerRoom: number; maxTotal: number; staleMs: number }
): SlotResult {
  const room = subsMap().get(code);
  const total = totalCounter().get();

  if ((room?.size ?? 0) >= opts.maxPerRoom || total >= opts.maxTotal) {
    reclaimZombies(code, playerId, opts.staleMs);
    const roomAfter = subsMap().get(code)?.size ?? 0;
    const totalAfter = totalCounter().get();
    if (roomAfter >= opts.maxPerRoom) return "room-full";
    if (totalAfter >= opts.maxTotal) return "global-full";
  }
  return "ok";
}

/** 回收僵尸订阅：同 playerId 的旧连接 + 超龄连接。返回回收数量。 */
export function reclaimZombies(
  code: string,
  playerId: string | undefined,
  staleMs: number
): number {
  const room = subsMap().get(code);
  if (!room) return 0;
  const now = Date.now();
  let removed = 0;
  for (const [controller, sub] of room) {
    const samePlayerOld =
      playerId !== undefined && sub.playerId === playerId && sub.playerId !== undefined;
    // 用 `>=` 而非 `>`：语义是「存活时长已达标即算超龄」，
    // staleMs=0 时同毫秒创建的订阅也应被判为超龄（测试与边界场景都依赖这一点）。
    const tooOld = now - sub.createdAt >= staleMs;
    if (samePlayerOld || tooOld) {
      room.delete(controller);
      totalCounter().set(totalCounter().get() - 1);
      removed++;
      try {
        controller.close();
      } catch {
        /* 已关闭 */
      }
    }
  }
  if (room.size === 0) subsMap().delete(code);
  return removed;
}

/** 注册一个订阅。 */
export function addSubscriber(
  code: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  playerId?: string
): void {
  const map = subsMap();
  let room = map.get(code);
  if (!room) {
    room = new Map();
    map.set(code, room);
  }
  room.set(controller, { controller, createdAt: Date.now(), playerId });
  totalCounter().set(totalCounter().get() + 1);
}

/** 移除一个订阅（幂等）。 */
export function removeSubscriber(
  code: string,
  controller: ReadableStreamDefaultController<Uint8Array>
): void {
  const map = subsMap();
  const room = map.get(code);
  if (!room) return;
  if (room.delete(controller)) {
    totalCounter().set(Math.max(0, totalCounter().get() - 1));
  }
  if (room.size === 0) map.delete(code);
}

/**
 * 清空全部订阅（仅测试用）。
 *
 * 订阅表是 `globalThis` 单例，**跨测试文件、跨用例都会残留**。
 * 不重置的话，后一个用例会看到前一个用例留下的僵尸订阅，
 * 配额与回收断言全部变成时序赌博。
 */
export function __resetSubscribersForTest(): void {
  const map = subsMap();
  for (const room of map.values()) {
    for (const [controller] of room) {
      try {
        controller.close();
      } catch {
        /* 已关闭 */
      }
    }
  }
  map.clear();
  totalCounter().set(0);
}

/** 向房间内所有订阅者广播一个业务事件。 */
export function broadcast(code: string, event: RoomEvent): void {
  const room = subsMap().get(code);
  if (!room || room.size === 0) return;
  const frame = eventToSse(event);
  const encoder = new TextEncoder();
  for (const [controller] of room) {
    try {
      controller.enqueue(encoder.encode(frame));
    } catch {
      // 写失败说明下游已断；由 SSE 路由的兜底路径负责清理
    }
  }
}

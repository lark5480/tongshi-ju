/**
 * 房间事件流 hook —— `fetch(POST)` + `ReadableStream` 读 SSE，不用 `EventSource`。
 *
 * ## 为什么不能用 EventSource
 *
 * `EventSource` 只能发 GET，而 Cloudflare Quick Tunnel（`play-online.bat` 给的
 * `xxx.trycloudflare.com`）会**整段缓冲 GET 的流式响应**：帧攒到连接关闭才吐出
 * （实测挂 100 秒 0 字节，服务端轮换关闭的瞬间一次性到达）。
 * 同一条隧道上 POST 是逐帧实时到达的 —— 所以这里改走 `fetch`，帧解析交给 `lib/sse.ts`。
 * 详见 `app/api/rooms/[code]/stream/route.ts` 的方法说明。
 *
 * ## 重连策略
 *
 * - 连接失败 / 流意外结束一律由本 hook 接管，走指数退避：3s → 30s 上限，带随机抖动；
 *   失败期刷屏重连会直接触发服务端 429；
 * - 收到服务端 `rotate` 事件后**静默立即重连**，不提示用户（这是正常的优雅轮换）；
 * - 连续失败 ≥3 次才 fetch 房间确认存在性，404 才停止重连。
 *
 * ## 时钟校准
 *
 * 快照里带 `serverNow`，据此算出 `serverOffset = serverNow - Date.now()`，
 * 倒计时用 `deadlineAt - (Date.now() + offset)` 渲染，
 * 避免用户改本地时间影响显示。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { splitSseFrames, type SseFrame } from "@/lib/sse";
import type { RoomEvent, RoomSnapshot } from "@/types";

/** 退避参数。 */
const BACKOFF_BASE = 3000;
const BACKOFF_MAX = 30000;
const BACKOFF_JITTER = 800;
const MAX_SILENT_RETRIES = 3;

export interface UseRoomStreamResult {
  snapshot: RoomSnapshot | null;
  /** 最近一次事件（供 UI 做瞬时反馈，如「对方已作答」）。 */
  lastEvent: RoomEvent | null;
  connecting: boolean;
  /** 是否正在重连（用于顶部提示条）。 */
  reconnecting: boolean;
  /** 服务端与本地时钟差值。 */
  serverOffset: number;
  /** 主动重连（用于网络恢复后立即同步）。 */
  reconnect: () => void;
  /**
   * 注入一份已知快照 —— **只在还没有快照时生效**。
   *
   * 用途：大厅创建房间后把快照预取过来，房间页首屏直接渲染，
   * 不必等事件流的第一个帧（慢链路上省一个往返）。
   * 已有的快照不会被覆盖 —— 流推来的状态永远更新。
   */
  seed: (snapshot: RoomSnapshot) => void;
}

export function useRoomStream(code: string, playerId: string | null): UseRoomStreamResult {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [lastEvent, setLastEvent] = useState<RoomEvent | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const stoppedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    clearTimer();
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    const url = `/api/rooms/${encodeURIComponent(code)}/stream${
      playerId ? `?playerId=${encodeURIComponent(playerId)}` : ""
    }`;

    /** 断线重连：退避等待；达到静默重试上限后先确认房间还存在。 */
    const scheduleRetry = () => {
      failuresRef.current += 1;
      setReconnecting(true);
      setConnecting(true);

      if (failuresRef.current >= MAX_SILENT_RETRIES) {
        void (async () => {
          try {
            const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
              cache: "no-store",
            });
            if (res.status === 404) {
              stoppedRef.current = true;
              clearTimer();
              setConnecting(false);
              setReconnecting(false);
            }
          } catch {
            // 网络不通，继续退避重试
          }
        })();
      }

      const base = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** (failuresRef.current - 1));
      const delay = base + Math.random() * BACKOFF_JITTER;
      clearTimer();
      timerRef.current = setTimeout(() => connect(), delay);
    };

    const handleFrame = (frame: SseFrame) => {
      let event: RoomEvent;
      try {
        event = JSON.parse(frame.data) as RoomEvent;
      } catch {
        return;
      }
      if (event.type === "state") {
        setServerOffset(event.room.serverNow - Date.now());
        setSnapshot(event.room);
        setLastEvent(event);
      } else {
        setLastEvent(event);
      }
    };

    void (async () => {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { Accept: "text/event-stream" },
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        // 本连接被主动 abort（卸载 / rotate 重连）时不计失败
        if (!stoppedRef.current && !controller.signal.aborted) scheduleRetry();
        return;
      }

      if (!res.ok || !res.body) {
        if (res.status === 404) {
          // 房间不存在：再重连也拿不到东西，停下来
          stoppedRef.current = true;
          setConnecting(false);
          setReconnecting(false);
          return;
        }
        if (!stoppedRef.current && !controller.signal.aborted) scheduleRetry();
        return;
      }

      failuresRef.current = 0;
      setConnecting(false);
      setReconnecting(false);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let rotated = false;
      try {
        while (!stoppedRef.current) {
          const { done, value } = await reader.read();
          if (done) break;
          const split = splitSseFrames(buffer + decoder.decode(value, { stream: true }));
          buffer = split.rest;
          for (const frame of split.frames) {
            // 服务端主动轮换：其后的帧随连接一起作废，重连后会重新推全量快照
            if (frame.event === "rotate") {
              rotated = true;
              break;
            }
            handleFrame(frame);
          }
          if (rotated) break;
        }
      } catch {
        if (!stoppedRef.current && !controller.signal.aborted) scheduleRetry();
        return;
      }

      if (stoppedRef.current) return;
      // rotate 是优雅轮换 → 立即静默重连；其余收尾（平台掐断、网络断开）→ 退避重试
      if (rotated) connect();
      else scheduleRetry();
    })();
  }, [code, playerId, clearTimer]);

  useEffect(() => {
    stoppedRef.current = false;
    failuresRef.current = 0;
    setConnecting(true);
    connect();

    return () => {
      stoppedRef.current = true;
      clearTimer();
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [code, playerId, connect, clearTimer]);

  const reconnect = useCallback(() => {
    failuresRef.current = 0;
    connect();
  }, [connect]);

  /**
   * 注入已知快照（首屏用）—— 只在没有快照时生效，并顺带做时钟校准。
   *
   * 校准必须一起做：快照里的 `serverNow` 是服务端的权威时间，
   * 倒计时直接依赖它，慢链路下不校准会整体偏移一个 RTT。
   */
  const seed = useCallback((next: RoomSnapshot) => {
    setServerOffset(next.serverNow - Date.now());
    setSnapshot((prev) => prev ?? next);
  }, []);

  return { snapshot, lastEvent, connecting, reconnecting, serverOffset, reconnect, seed };
}

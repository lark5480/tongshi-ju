/**
 * 房间 SSE 连接 hook。
 *
 * ## 重连策略（必须与 chess-arena 一致）
 *
 * - `es.onerror` 时**先 `es.close()` 接管重连**，禁止依赖浏览器 EventSource 的
 *   原生自动重连 —— 它固定约 3s 且无退避，故障期会刷屏请求直接触发 429；
 * - 统一走指数退避：3s → 30s 上限，带随机抖动；
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
}

export function useRoomStream(code: string, playerId: string | null): UseRoomStreamResult {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [lastEvent, setLastEvent] = useState<RoomEvent | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const stoppedRef = useRef(false);
  const offsetRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const connect = useCallback(
    (immediate: boolean) => {
      if (stoppedRef.current) return;
      clearTimer();

      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const url = `/api/rooms/${encodeURIComponent(code)}/stream${
        playerId ? `?playerId=${encodeURIComponent(playerId)}` : ""
      }`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        failuresRef.current = 0;
        setConnecting(false);
        setReconnecting(false);
      };

      es.onerror = () => {
        // 接管重连：先关掉，交由我们自己的退避逻辑处理
        es.close();
        if (esRef.current === es) esRef.current = null;
        if (stoppedRef.current) return;

        failuresRef.current += 1;
        setReconnecting(true);
        setConnecting(true);

        // 连续失败多次后，先确认房间是否还存在（404 则停止重连）
        if (failuresRef.current >= MAX_SILENT_RETRIES) {
          void (async () => {
            try {
              const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
                cache: "no-store",
              });
              if (res.status === 404) {
                stoppedRef.current = true;
                setConnecting(false);
                setReconnecting(false);
                return;
              }
            } catch {
              // 网络不通，继续退避重试
            }
          })();
        }

        const base = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** (failuresRef.current - 1));
        const delay = immediate ? 0 : base + Math.random() * BACKOFF_JITTER;
        clearTimer();
        timerRef.current = setTimeout(() => connect(false), delay);
      };

      const handle = (e: MessageEvent) => {
        let event: RoomEvent;
        try {
          event = JSON.parse(e.data) as RoomEvent;
        } catch {
          return;
        }
        if (event.type === "state") {
          const offset = event.room.serverNow - Date.now();
          offsetRef.current = offset;
          setServerOffset(offset);
          setSnapshot(event.room);
          setLastEvent(event);
        } else {
          setLastEvent(event);
        }
      };

      for (const name of [
        "state",
        "player_answered",
        "round_locked",
        "round_result",
        "round_start",
        "countdown",
        "duel_end",
      ]) {
        es.addEventListener(name, handle as EventListener);
      }

      // 服务端主动轮换：静默立即重连，不打扰用户
      es.addEventListener("rotate", () => {
        es.close();
        if (esRef.current === es) esRef.current = null;
        if (stoppedRef.current) return;
        connect(true);
      });
    },
    [code, playerId, clearTimer]
  );

  useEffect(() => {
    stoppedRef.current = false;
    failuresRef.current = 0;
    setConnecting(true);
    connect(true);

    return () => {
      stoppedRef.current = true;
      clearTimer();
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [code, playerId, connect, clearTimer]);

  const reconnect = useCallback(() => {
    failuresRef.current = 0;
    connect(true);
  }, [connect]);

  return { snapshot, lastEvent, connecting, reconnecting, serverOffset, reconnect };
}

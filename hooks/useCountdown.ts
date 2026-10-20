/**
 * 倒计时 hook —— 只负责**显示**，不负责判定。
 *
 * 权威截止时间在服务端（`deadlineAt` 是服务端时间戳），
 * 客户端用 `serverOffset` 校准本地时钟差，避免用户改本地时间影响显示。
 *
 * 计时器清理遵循 K-003：保存 timer id，在依赖变化与卸载时**双路清理**。
 */

"use client";

import { useEffect, useRef, useState } from "react";

export interface CountdownResult {
  /** 剩余毫秒（不小于 0）。 */
  remaining: number;
  /** 剩余秒数（向上取整，用于展示）。 */
  seconds: number;
  /** 是否已到期。 */
  expired: boolean;
}

/**
 * @param deadlineAt 服务端截止时间戳（ms）。null 表示无倒计时。
 * @param serverOffset 服务端时间与本地时间的差值 = serverNow - clientNow
 */
export function useCountdown(deadlineAt: number | null, serverOffset = 0): CountdownResult {
  const [remaining, setRemaining] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 清理旧计时器（双路清理的第一路：依赖变化时）
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (deadlineAt === null) {
      setRemaining(0);
      return;
    }

    const tick = () => {
      const now = Date.now() + serverOffset;
      setRemaining(Math.max(0, deadlineAt - now));
    };
    tick();
    timerRef.current = setInterval(tick, 200);

    // 双路清理的第二路：卸载时
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [deadlineAt, serverOffset]);

  return {
    remaining,
    seconds: Math.ceil(remaining / 1000),
    expired: deadlineAt !== null && remaining <= 0,
  };
}

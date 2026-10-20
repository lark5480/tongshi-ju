"use client";

import { Ghost } from "lucide-react";

import type { GhostRecord } from "@/lib/engine/ghost";

interface GhostBarProps {
  /** 本局对应的影子（挑战开始前的历史最好成绩）。 */
  ghost: GhostRecord | null;
  /** 当前累计得分。 */
  playerScore: number;
  /** 本局理论满分。 */
  maxPossible: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 影子目标线 —— 答题过程中把「过去的自己」画成一条可见的线。
 *
 * ## 为什么不做成"两个小人赛跑"
 *
 * 我们**没有**影子每一题的确切用时（本地只存了总成绩），
 * 硬造一条"影子在第 2 题用了 8 秒"的曲线就是**编数据**。
 * 所以这里只画一条诚实的线：影子的**最终成绩**。
 *
 * 它不是假的赛跑，是一条**及格线 / 目标线**：
 * "你需要在剩下两题里越过这条线。" 这比假赛跑更有张力，也更诚实。
 */
export function GhostBar({ ghost, playerScore, maxPossible }: GhostBarProps) {
  if (!ghost || maxPossible <= 0) return null;

  const playerRatio = clamp01(playerScore / maxPossible);
  const ghostRatio = clamp01(ghost.bestScore / maxPossible);
  const gap = ghost.bestScore - playerScore;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted">
          <Ghost size={13} className="text-gold" aria-hidden />
          影子 · {ghost.bestDate} 的你
        </span>
        <span className="tabular font-semibold text-gold">{ghost.bestScore} 分</span>
      </div>

      <div className="relative h-2 w-full overflow-hidden rounded-pill bg-surface-2">
        <div
          className="absolute inset-y-0 left-0 w-full origin-left rounded-pill bg-gradient-to-r from-accent-soft to-accent transition-transform duration-base"
          style={{ transform: `scaleX(${playerRatio})` }}
        />
        {/* 影子目标线 */}
        <span
          aria-hidden
          className="absolute inset-y-0 w-[2px] bg-gold shadow-glow-sm"
          style={{ left: `${ghostRatio * 100}%`, ["--glow-color" as string]: "#FFC24B" }}
        />
      </div>

      <p className="text-[11px] text-dim">
        {gap > 0 ? `再得 ${gap} 分越过影子` : `已经越过影子 ${-gap} 分`}
      </p>
    </div>
  );
}

"use client";

import { Zap } from "lucide-react";

import { domainColor } from "@/content/domains";
import { comboMultiplier } from "@/lib/engine/scoring";
import type { DomainId } from "@/types";

/** 一个链条槽位（对应一题）。 */
export interface ChainSlot {
  domain: DomainId;
  /** 是否已作答。 */
  answered: boolean;
  /** 是否答对。 */
  correct: boolean;
}

interface KnowledgeChainProps {
  slots: ChainSlot[];
  /** 当前连击数。 */
  combo: number;
}

/**
 * 知识链 —— 把「跨域连击」从一串数字变成**看得见的轨道**。
 *
 * 设计意图：连击机制在评分公式里已经存在很久了，但它此前只是一个数字。
 * 把它可视化成"一格一格亮起来的链"，玩家才能在答题过程中**感知**到
 * "这一格是新的领域，我在把不同领域连成一条线" —— 这正是"通识"这个词的字面意思。
 *
 * 每格的颜色 = 该题所属领域的颜色，于是"连击"在视觉上也天然是**跨域**的。
 */
export function KnowledgeChain({ slots, combo }: KnowledgeChainProps) {
  const multiplier = comboMultiplier(combo);
  const hot = combo >= 2;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span
          className={`flex items-center gap-1.5 font-medium ${hot ? "text-accent" : "text-muted"}`}
        >
          <Zap size={13} strokeWidth={2.2} className={hot ? "text-accent" : "text-dim"} aria-hidden />
          {hot ? `知识链 · ${combo} 连击` : "知识链"}
        </span>
        {hot && (
          <span className="tabular font-semibold text-accent">×{multiplier.toFixed(2)}</span>
        )}
      </div>

      <div
        className="flex gap-1.5"
        role="img"
        aria-label={`知识链：${combo} 连击，倍率 ${multiplier.toFixed(2)}`}
      >
        {slots.map((s, i) => (
          <span
            key={i}
            className="chain-seg"
            style={
              s.answered
                ? {
                    background: s.correct ? domainColor(s.domain) : "rgba(251,113,133,.45)",
                  }
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

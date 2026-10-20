"use client";

import type { CSSProperties } from "react";
import {
  Brain,
  CircleDot,
  Compass,
  Dices,
  Flame,
  Medal,
  NotebookPen,
  Rocket,
  Sparkles,
  Star,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { DomainId, DomainMeta } from "@/types";
import { masteryStars } from "@/lib/storage";

/**
 * 12 域 → 图标映射。
 *
 * 为什么不直接用 `domain.emoji`：emoji 是**数据字段**（写进档案、会随对战快照
 * 广播给对手），组件层改用 SVG 图标渲染，emoji 字段本身保持不变。
 */
const DOMAIN_ICONS: Record<DomainId, LucideIcon> = {
  gaming: Dices,
  anime: Sparkles,
  tech: Zap,
  coding: CircleDot,
  life: Flame,
  history: Medal,
  auto: Rocket,
  mobile: Target,
  film: Star,
  science: Brain,
  literature: NotebookPen,
  travel: Compass,
};

/** 取某个领域的图标；未知领域给一个中性图标。 */
export function domainIcon(id: DomainId): LucideIcon {
  return DOMAIN_ICONS[id] ?? CircleDot;
}

interface DomainCardProps {
  domain: DomainMeta;
  selected: boolean;
  /** 该域的历史熟练度（0-5 星）。 */
  mastery: number;
  onToggle: (id: DomainMeta["id"]) => void;
  disabled?: boolean;
}

export function DomainCard({ domain, selected, mastery, onToggle, disabled }: DomainCardProps) {
  const stars = masteryStars(mastery);
  const notReady = !domain.enabled;
  const Icon = domainIcon(domain.id);

  return (
    <button
      type="button"
      data-selected={selected}
      disabled={disabled || notReady}
      onClick={() => !notReady && onToggle(domain.id)}
      // 域色光晕只在 hover / 选中时出现 —— 12 张卡同时发光会失控
      className="domain-card text-left enabled:hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-55"
      style={
        {
          "--glow-color": domain.color,
          ...(selected
            ? { boxShadow: `0 0 0 1px ${domain.color}66, 0 10px 34px -14px ${domain.color}` }
            : {}),
        } as CSSProperties
      }
    >
      {/* 顶部域色条 */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] rounded-t-lg"
        style={{ background: domain.color }}
      />

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid h-10 w-10 shrink-0 place-items-center rounded-md"
          style={{ background: `${domain.color}22`, color: domain.color }}
        >
          <Icon size={19} strokeWidth={2.1} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold">{domain.name}</span>
            {notReady && (
              <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-[10px] text-muted">
                筹备中
              </span>
            )}
            {selected && (
              <span
                className="rounded-pill px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ background: domain.color }}
              >
                已选
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-xs text-muted">
            {domain.topics.slice(0, 3).join(" · ")}
            {domain.topics.length > 3 ? " …" : ""}
          </p>

          <div
            className="mt-2 flex items-center gap-1"
            role="img"
            aria-label={`熟练度 ${stars} 星`}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="star-dot"
                data-filled={i < stars}
                style={i < stars ? { background: domain.color } : undefined}
              />
            ))}
            {domain.batch > 1 && (
              <span className="ml-1 text-[10px] text-muted">第 {domain.batch} 批</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

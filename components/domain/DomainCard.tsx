"use client";

import type { DomainMeta } from "@/types";
import { masteryStars } from "@/lib/storage";

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

  return (
    <button
      type="button"
      data-selected={selected}
      disabled={disabled}
      onClick={() => !notReady && onToggle(domain.id)}
      className="domain-card text-left disabled:cursor-not-allowed disabled:opacity-55"
      style={
        selected
          ? { boxShadow: `0 0 0 1px ${domain.color}55, 0 8px 24px -12px ${domain.color}` }
          : undefined
      }
    >
      {/* 主题色装饰条 */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: domain.color }}
      />

      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none" aria-hidden>
          {domain.emoji}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{domain.name}</span>
            {notReady && (
              <span className="rounded bg-border px-1.5 py-0.5 text-[10px] text-muted">筹备中</span>
            )}
            {selected && (
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
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

          <div className="mt-2 flex items-center gap-1" aria-label={`熟练度 ${stars} 星`}>
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

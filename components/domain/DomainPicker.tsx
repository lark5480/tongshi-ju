"use client";

import { useMemo } from "react";
import { Layers } from "lucide-react";

import type { DomainId } from "@/types";
import { DOMAINS } from "@/content/domains";
import { DomainCard } from "./DomainCard";
import { getMastery } from "@/lib/storage";

interface DomainPickerProps {
  selected: DomainId[];
  onChange: (next: DomainId[]) => void;
  max?: number;
  disabled?: boolean;
}

/**
 * 领域选择器。
 *
 * 允许选 1-3 个（少于 3 个也是合法且被鼓励的玩法：「我只玩编程」）。
 * 未上线的领域展示但不可选，并标记「筹备中」。
 */
export function DomainPicker({ selected, onChange, max = 3, disabled }: DomainPickerProps) {
  const mastery = useMemo(() => getMastery(), []);

  const toggle = (id: DomainId) => {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    if (selected.length >= max) return;
    onChange([...selected, id]);
  };

  const remaining = max - selected.length;

  return (
    <div className="space-y-3">
      {/* 已选计数 */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
        <Layers size={14} className="shrink-0 text-dim" aria-hidden />
        <span className="text-xs text-muted">已选领域</span>
        <span className="tabular ml-auto text-sm font-semibold">
          {selected.length} / {max}
        </span>
      </div>

      <p className="text-xs text-dim">
        {remaining > 0 ? `还可以再选 ${remaining} 个` : "已经选满了，取消一个才能换新的"}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DOMAINS.map((d) => (
          <DomainCard
            key={d.id}
            domain={d}
            selected={selected.includes(d.id)}
            mastery={mastery[`${d.id}|${d.topics[0] ?? ""}`] ?? 0}
            onToggle={toggle}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}

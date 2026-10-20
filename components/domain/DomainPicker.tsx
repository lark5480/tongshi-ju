"use client";

import { useMemo } from "react";

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

  return (
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
  );
}

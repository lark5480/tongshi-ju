"use client";

import { useEffect, useState } from "react";
import { Dices, Shuffle, Sparkles, Target } from "lucide-react";

import { DOMAINS } from "@/content/domains";
import { DomainPicker } from "@/components/domain/DomainPicker";
import { Button } from "@/components/ui/Button";
import { getProfile, saveProfile } from "@/lib/storage";
import { dayKey } from "@/lib/engine/date";
import { pickRandomDomains } from "@/lib/engine/daily";
import { dailyModeHint, dailyModeLabel, type DailyMode } from "@/lib/engine/blindbox";
import type { DomainId } from "@/types";

/** 三种领域模式 —— 决定"今天的题从哪来"。 */
const MODES: { id: DailyMode; icon: typeof Target; blurb: string }[] = [
  { id: "native", icon: Target, blurb: "固定挑战你选定的领域" },
  { id: "blindbox", icon: Sparkles, blurb: "1 个本命 + 2 个每日盲盒" },
  { id: "random", icon: Dices, blurb: "每天换 3 个领域" },
];

/**
 * 选域页。
 *
 * 三种模式（见 `lib/engine/blindbox.ts`）：
 * - **本命模式**：最多选 3 个，题目稳定不变；
 * - **盲盒轮转**：只选 1 个本命，另外 2 个由日期种子每日轮换 —— 强制跨域；
 * - **随缘开局**：不选，每天由日期种子随机 3 个已上线领域（全网同天一致）。
 *
 * 「不选也行」：直接点「随缘开局」，首次可免费重抽 1 次。
 */
export default function DomainsPage() {
  const [selected, setSelected] = useState<DomainId[]>([]);
  const [usedReroll, setUsedReroll] = useState(false);
  const [mode, setMode] = useState<DailyMode>("native");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = getProfile();
    setSelected(p.domains);
    setUsedReroll(p.usedReroll);
    setMode(p.blindbox ? "blindbox" : p.domains.length > 0 ? "native" : "random");
    setReady(true);
  }, []);

  const enabledIds = DOMAINS.filter((d) => d.enabled).map((d) => d.id);

  const randomize = () => {
    setSelected(pickRandomDomains(dayKey(), enabledIds, 3));
  };

  const reroll = () => {
    if (usedReroll) return;
    randomize();
    setUsedReroll(true);
    saveProfile({ usedReroll: true });
  };

  /**
   * 切换模式。
   *
   * 切到盲盒时必须把本命裁到 1 个 —— 否则界面会停在「已选 3 / 上限 1」这种不可能的计数态
   * （存档走 `confirm()` 的 `slice(0, 1)` 所以数据仍然正确，坏的是可见状态）。
   */
  const switchMode = (next: DailyMode) => {
    setMode(next);
    if (next === "blindbox") setSelected((prev) => prev.slice(0, 1));
  };

  const confirm = () => {
    if (mode === "random") {
      saveProfile({ domains: [], blindbox: false });
    } else if (mode === "blindbox") {
      // 盲盒模式只保留第 1 个作为本命
      saveProfile({ domains: selected.slice(0, 1), blindbox: true });
    } else {
      saveProfile({ domains: selected, blindbox: false });
    }
    window.location.href = "/daily";
  };

  if (!ready) return null;

  const max = mode === "blindbox" ? 1 : 3;
  const selectedNames = selected
    .map((id) => DOMAINS.find((d) => d.id === id)?.name)
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold tracking-tight">选你的本命领域</h1>
        <p className="mt-1 text-sm text-muted">
          最多选 3 个。选得越杂，跨域连击越容易打出来；只选一个也完全可以。
        </p>
      </header>

      {/* 模式选择 */}
      <div className="grid grid-cols-3 gap-2">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => switchMode(m.id)}
              aria-pressed={active}
              className={`min-h-[76px] rounded-lg border p-2.5 text-left transition-all duration-fast ${
                active
                  ? "border-accent bg-accent/10"
                  : "border-border bg-surface hover:border-border-strong"
              }`}
            >
              <Icon size={16} className={active ? "text-accent" : "text-dim"} aria-hidden />
              <div
                className={`mt-1.5 text-[13px] font-semibold ${active ? "text-accent" : "text-fg"}`}
              >
                {dailyModeLabel(m.id)}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-dim">{m.blurb}</div>
            </button>
          );
        })}
      </div>

      <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
        {dailyModeHint(mode)}
      </p>

      {mode !== "random" && (
        <DomainPicker
          selected={selected}
          // 传 updater 而不是数组：连点同一帧内也要能叠加（见 DomainPicker 的 props 注释）
          onChange={(update) => setSelected(update)}
          max={max}
        />
      )}

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="shrink-0 text-muted">已选</span>
          <span className="truncate font-medium">
            {mode === "random"
              ? "不选 —— 每天由日期决定"
              : selectedNames.length > 0
                ? selectedNames
                : "尚未选择"}
          </span>
        </div>

        {mode === "random" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={randomize}>
              <Dices size={15} aria-hidden />
              随缘开局
            </Button>
            <Button variant="ghost" onClick={reroll} disabled={usedReroll}>
              <Shuffle size={15} aria-hidden />
              {usedReroll ? "重抽已用完" : "免费重抽一次"}
            </Button>
          </div>
        )}

        {mode === "blindbox" && (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-dim">
            盲盒里的 2 个领域每天自动更换，与全网同一天一致。
          </p>
        )}

        <Button block size="lg" onClick={confirm}>
          {mode === "random"
            ? "随缘开始今日挑战"
            : mode === "blindbox"
              ? "开启盲盒轮转"
              : "开始今日挑战"}
        </Button>
        <p className="text-center text-xs text-muted">
          修改领域只对「次日」生效 —— 今天的题目已经锁定，不会重算。
        </p>
      </div>
    </div>
  );
}

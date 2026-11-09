"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { domainIcon } from "@/components/domain/DomainCard";
import { playerNameSchema } from "@/lib/store/validate";
import type { DomainId } from "@/types";

interface ProfileSetupProps {
  mode: "first-run" | "edit";
  initialName: string;
  initialDomains: DomainId[];
  onSave: (profile: { name: string; domains: DomainId[] }) => void;
  onCancel?: () => void;
  onSkip?: () => void;
}

/**
 * 首启 / 编辑资料卡。
 *
 * 用紧凑的领域胶囊而不是 12 张领域大卡：首屏最需要的是「能马上开一局」，
 * 不能让人先滚过一屏领域卡才看到每日挑战入口。
 */
export function ProfileSetup({
  mode,
  initialName,
  initialDomains,
  onSave,
  onCancel,
  onSkip,
}: ProfileSetupProps) {
  const [name, setName] = useState(initialName);
  const [domains, setDomains] = useState<DomainId[]>(initialDomains);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: DomainId) => {
    setDomains((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
    if (error) setError(null);
  };

  const save = () => {
    const parsed = playerNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "昵称不合法");
      return;
    }
    if (domains.length === 0) {
      setError("至少选 1 个本命领域；想随缘就点「随缘开局」");
      return;
    }
    setError(null);
    onSave({ name: parsed.data, domains });
  };

  return (
    <section className="panel space-y-4 p-5" aria-labelledby="profile-setup-title">
      <div className="space-y-1">
        <h2 id="profile-setup-title" className="text-lg font-semibold">
          {mode === "first-run" ? "先花 10 秒，给自己起个名字" : "编辑资料"}
        </h2>
        <p className="text-sm text-muted">
          {mode === "first-run"
            ? "选 1–3 个本命领域；以后每天按你的选择出题。"
            : "昵称会出现在成绩卡上；领域决定每日挑战的默认组合。"}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="profile-name" className="text-xs font-medium text-muted">
          昵称
        </label>
        <input
          id="profile-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
          maxLength={12}
          autoComplete="nickname"
          placeholder="1–12 个字"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "profile-name-error" : undefined}
          className="min-h-[44px] w-full rounded-md border border-border bg-surface-2 px-3 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">本命领域</span>
          <span className="tabular text-xs text-dim">{domains.length} / 3</span>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="选择本命领域">
          {DOMAINS.map((d) => {
            const on = domains.includes(d.id);
            const Icon = domainIcon(d.id);
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                aria-label={`${on ? "取消选择" : "选择"}${d.name}领域`}
                disabled={!d.enabled}
                onClick={() => toggle(d.id)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                  on
                    ? "font-semibold text-fg"
                    : "border-border bg-surface-2 text-muted hover:border-border-strong"
                }`}
                style={on ? { borderColor: d.color, background: `${d.color}22` } : undefined}
              >
                <Icon size={15} style={{ color: d.color }} aria-hidden />
                {d.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-[1rem] text-xs" aria-live="polite">
        {error && (
          <p id="profile-name-error" className="text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={save} block>
          {mode === "first-run" ? "保存并开始" : "保存"}
        </Button>
        {mode === "first-run" && onSkip && (
          <Button variant="secondary" onClick={onSkip} block>
            随缘开局
          </Button>
        )}
        {mode === "edit" && onCancel && (
          <Button variant="ghost" onClick={onCancel} block>
            取消
          </Button>
        )}
      </div>
    </section>
  );
}

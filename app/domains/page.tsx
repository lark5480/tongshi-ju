"use client";

import { useEffect, useState } from "react";

import { DOMAINS } from "@/content/domains";
import { DomainPicker } from "@/components/domain/DomainPicker";
import { Button } from "@/components/ui/Button";
import { getProfile, getStreak, saveProfile } from "@/lib/storage";
import { dayKey } from "@/lib/engine/date";
import { pickRandomDomains } from "@/lib/engine/daily";
import type { DomainId } from "@/types";

/**
 * 选域页。
 *
 * 「不选也行」：直接点「随缘开局」，系统按**当日种子**确定性地随机 3 个已上线领域
 * —— 全网同一天结果一致。首次可免费重抽 1 次。
 */
export default function DomainsPage() {
  const [selected, setSelected] = useState<DomainId[]>([]);
  const [usedReroll, setUsedReroll] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = getProfile();
    setSelected(p.domains);
    setUsedReroll(p.usedReroll);
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

  const confirm = () => {
    const next = selected.length > 0 ? selected : pickRandomDomains(dayKey(), enabledIds, 3);
    saveProfile({ domains: next });
    window.location.href = "/daily";
  };

  if (!ready) return null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">选你的本命领域</h1>
        <p className="mt-1 text-sm text-muted">
          最多选 3 个。选得越杂，跨域连击越容易打出来；只选一个也完全可以。
        </p>
      </header>

      <DomainPicker selected={selected} onChange={setSelected} max={3} />

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted">已选</span>
          <span className="font-medium">
            {selected.length > 0
              ? selected.map((id) => DOMAINS.find((d) => d.id === id)?.name).join(" · ")
              : "尚未选择（将按「随缘」开局）"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={randomize} disabled={selected.length >= 3}>
            🎲 随缘开局
          </Button>
          <Button variant="ghost" onClick={reroll} disabled={usedReroll}>
            {usedReroll ? "重抽已用完" : "免费重抽一次"}
          </Button>
        </div>

        <Button block size="lg" onClick={confirm}>
          {selected.length > 0 ? "开始今日挑战" : "随缘开始今日挑战"}
        </Button>
        <p className="text-center text-xs text-muted">
          修改领域只对**次日**生效 —— 今天的题目已经锁定，不会重算。
        </p>
      </div>
    </div>
  );
}

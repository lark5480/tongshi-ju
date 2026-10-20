"use client";

import { useEffect, useState } from "react";

import { domainName } from "@/content/domains";
import { getHistory } from "@/lib/storage";
import type { HistoryEntry } from "@/types";

/** 战绩：最近 30 场记录（每日挑战与对战）。 */
export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEntries(getHistory());
    setReady(true);
  }, []);

  if (!ready) return null;

  if (entries.length === 0) {
    return (
      <div className="panel space-y-2 p-8 text-center">
        <div className="text-4xl">📊</div>
        <p className="font-medium">还没有记录</p>
        <p className="text-sm text-muted">完成一次每日挑战就会出现在这里。</p>
      </div>
    );
  }

  const totalScore = entries.reduce((s, e) => s + e.score, 0);
  const totalCorrect = entries.reduce((s, e) => s + e.correct, 0);
  const totalQuestions = entries.reduce((s, e) => s + e.total, 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">📊 战绩</h1>
        <p className="mt-1 text-sm text-muted">最近 {entries.length} 场</p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-3 text-center">
          <div className="tabular text-xl font-bold text-accent">{totalScore}</div>
          <div className="text-xs text-muted">总得分</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="tabular text-xl font-bold">
            {totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0}%
          </div>
          <div className="text-xs text-muted">正确率</div>
        </div>
        <div className="panel p-3 text-center">
          <div className="tabular text-xl font-bold">{entries.length}</div>
          <div className="text-xs text-muted">场次</div>
        </div>
      </div>

      <div className="space-y-2">
        {entries.map((e, i) => (
          <div key={`${e.date}-${i}`} className="panel p-3">
            <div className="flex items-center gap-2">
              <span className="tabular text-sm font-medium">{e.date}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                {e.mode === "daily" ? "每日" : "对战"}
              </span>
              <span className="ml-auto text-sm text-warn">{"⭐".repeat(e.stars)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
              <span className="tabular font-semibold text-accent">{e.score} 分</span>
              <span className="tabular">
                {e.correct} / {e.total} 题
              </span>
              {e.maxCombo >= 2 && <span>🔥 {e.maxCombo} 连击</span>}
              <span className="ml-auto truncate">
                {e.domains.map((d) => domainName(d)).join(" · ")}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

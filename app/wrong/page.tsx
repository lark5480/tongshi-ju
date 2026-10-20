"use client";

import { useEffect, useMemo, useState } from "react";

import { domainColor, domainEmoji, domainName } from "@/content/domains";
import { getWrongEntries } from "@/lib/storage";
import { masteryRatio } from "@/lib/engine/repetition";
import type { WrongEntry } from "@/types";

/** 错题本：按领域分组，展示掌握进度与到期状态。 */
export default function WrongPage() {
  const [entries, setEntries] = useState<WrongEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEntries(getWrongEntries());
    setReady(true);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, WrongEntry[]>();
    for (const e of entries) {
      const list = map.get(e.domain) ?? [];
      list.push(e);
      map.set(e.domain, list);
    }
    return Array.from(map.entries());
  }, [entries]);

  if (!ready) return null;

  if (entries.length === 0) {
    return (
      <div className="panel space-y-2 p-8 text-center">
        <div className="text-4xl">✨</div>
        <p className="font-medium">错题本还是空的</p>
        <p className="text-sm text-muted">
          答错的题会自动进来。连续答对两次就会「毕业」离开 —— 老朋友会再来找你几次。
        </p>
      </div>
    );
  }

  const now = Date.now();
  const dueCount = entries.filter((e) => e.nextDueAt <= now).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">📕 错题本</h1>
        <p className="mt-1 text-sm text-muted">
          共 {entries.length} 题 · 掌握度 {Math.round(masteryRatio(entries) * 100)}% ·{" "}
          {dueCount > 0 ? `${dueCount} 题该复习了` : "暂时没有到期的题"}
        </p>
      </header>

      {grouped.map(([domain, list]) => (
        <section key={domain} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{domainEmoji(domain as never)}</span>
            <h2 className="font-semibold">{domainName(domain as never)}</h2>
            <span className="tabular ml-auto text-sm text-muted">{list.length} 题</span>
          </div>

          {list.map((e) => {
            const due = e.nextDueAt <= now;
            return (
              <div key={e.questionId} className="panel p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                    {e.topic}
                  </span>
                  <span className="text-xs text-muted">错 {e.wrongCount} 次</span>
                  <span className="ml-auto flex items-center gap-0.5" aria-label="连对进度">
                    {[0, 1].map((i) => (
                      <span
                        key={i}
                        className="star-dot"
                        data-filled={i < e.streak}
                        style={
                          i < e.streak ? { background: domainColor(domain as never) } : undefined
                        }
                      />
                    ))}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={due ? "text-warn" : "text-muted"}>
                    {due ? "🔔 该复习了" : `下次复习：${formatDue(e.nextDueAt, now)}`}
                  </span>
                  <span className="text-muted">难度 {e.ease.toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/** 把下次复习时间渲染成人类可读的相对描述。 */
function formatDue(nextDueAt: number, now: number): string {
  const diff = nextDueAt - now;
  const days = Math.ceil(diff / 86400000);
  if (diff <= 0) return "现在";
  if (days <= 1) return "明天";
  if (days <= 30) return `${days} 天后`;
  return `${Math.round(days / 30)} 个月后`;
}

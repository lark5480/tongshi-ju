"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Flame,
  NotebookPen,
  Orbit,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
} from "lucide-react";

import { buttonClass } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { getProfile, getRankSnapshot, getStreak, isPersistent } from "@/lib/storage";
import { dayKey } from "@/lib/engine/date";
import type { RankSnapshot } from "@/lib/engine/rank";

/** 首页：今日挑战入口 + 段位与战绩速览。 */
export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🧠");
  const [domains, setDomains] = useState<string[]>([]);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [persistent, setPersistent] = useState(true);
  const [rank, setRank] = useState<RankSnapshot | null>(null);

  useEffect(() => {
    const p = getProfile();
    const s = getStreak();
    setName(p.name);
    setEmoji(p.emoji);
    setDomains(p.domains);
    setStreak(s.current);
    setBest(s.best);
    setPersistent(isPersistent());
    setRank(getRankSnapshot());
    setReady(true);
  }, []);

  if (!ready) return null;

  const dateLabel = dayKey();
  const domainNames = domains
    .map((d) => DOMAINS.find((x) => x.id === d)?.name)
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-dim">{dateLabel}</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {emoji} {name}，今天也来一局？
        </h1>
        <p className="text-sm text-muted">每天三域，各显所长。5 道题，3 分钟。</p>
      </header>

      {/* 今日挑战 */}
      <div className="panel space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted">今日挑战</div>
            <div className="mt-0.5 truncate text-lg font-semibold">
              {domainNames.length > 0 ? domainNames : "随缘三域"}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tabular text-2xl font-bold text-accent">{streak}</div>
            <div className="text-xs text-muted">连续天数</div>
          </div>
        </div>

        {/* 段位徽章 */}
        {rank && (
          <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gradient-to-br from-accent-soft to-accent text-white shadow-glow-sm">
              <Trophy size={17} strokeWidth={2.2} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold">{rank.tierName}</span>
                <span className="truncate text-xs text-muted">{rank.tierBlurb}</span>
              </div>
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-pill bg-surface-3">
                <div
                  className="h-full w-full origin-left rounded-pill bg-accent transition-transform duration-base"
                  style={{ transform: `scaleX(${rank.progress})` }}
                />
              </div>
            </div>
            <span className="tabular shrink-0 text-xs text-dim">
              {rank.maxed ? "MAX" : rank.nextGap}
            </span>
          </div>
        )}

        <Link href="/daily" className={buttonClass("primary", "lg", true)}>
          <Sparkles size={16} aria-hidden />
          开始今日挑战
        </Link>

        {domains.length === 0 && (
          <Link
            href="/domains"
            className="flex min-h-[44px] items-center justify-center text-center text-xs text-accent"
          >
            先选三个本命领域 →
          </Link>
        )}
      </div>

      {/* 战绩速览 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="panel p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Flame size={13} className="text-gold" aria-hidden />
            最长连续
          </div>
          <div className="tabular mt-1 text-2xl font-bold">{best} 天</div>
        </div>
        <div className="panel p-4">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Sparkles size={13} className="text-accent" aria-hidden />
            已选领域
          </div>
          <div className="tabular mt-1 text-2xl font-bold">{domains.length} / 3</div>
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/pk">
          <div className="panel lift p-4 hover:border-border-strong">
            <Users size={20} className="text-info" aria-hidden />
            <div className="mt-2 font-medium">同题 PK</div>
            <div className="text-xs text-muted">同一个码，同一份题</div>
          </div>
        </Link>
        <Link href="/domains">
          <div className="panel lift p-4 hover:border-border-strong">
            <Target size={20} className="text-accent" aria-hidden />
            <div className="mt-2 font-medium">选本命领域</div>
            <div className="text-xs text-muted">本命 / 盲盒 / 随缘</div>
          </div>
        </Link>
        <Link href="/duel">
          <div className="panel lift p-4 hover:border-border-strong">
            <Swords size={20} className="text-accent" aria-hidden />
            <div className="mt-2 font-medium">同步抢答</div>
            <div className="text-xs text-muted">和朋友同题面抢答</div>
          </div>
        </Link>
        <Link href="/map">
          <div className="panel lift p-4 hover:border-border-strong">
            <Orbit size={20} className="text-info" aria-hidden />
            <div className="mt-2 font-medium">知识星图</div>
            <div className="text-xs text-muted">看看你在哪些域更强</div>
          </div>
        </Link>
        <Link href="/wrong">
          <div className="panel lift p-4 hover:border-border-strong">
            <NotebookPen size={20} className="text-gold" aria-hidden />
            <div className="mt-2 font-medium">错题本</div>
            <div className="text-xs text-muted">答错的题在这里排队计时</div>
          </div>
        </Link>
        <Link href="/history">
          <div className="panel lift p-4 hover:border-border-strong">
            <BarChart3 size={20} className="text-success" aria-hidden />
            <div className="mt-2 font-medium">战绩</div>
            <div className="text-xs text-muted">最近 30 场记录</div>
          </div>
        </Link>
      </div>

      {!persistent && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          当前浏览器无法持久化存储（可能是隐私模式），本次进度不会保存。
        </div>
      )}
    </div>
  );
}

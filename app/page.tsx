"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { getProfile, getStreak, isPersistent } from "@/lib/storage";
import { dayKey } from "@/lib/engine/date";

/** 首页：今日挑战入口 + 战绩速览。 */
export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🧠");
  const [domains, setDomains] = useState<string[]>([]);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [persistent, setPersistent] = useState(true);

  useEffect(() => {
    const p = getProfile();
    const s = getStreak();
    setName(p.name);
    setEmoji(p.emoji);
    setDomains(p.domains);
    setStreak(s.current);
    setBest(s.best);
    setPersistent(isPersistent());
    setReady(true);
  }, []);

  if (!ready) return null;

  const dateLabel = dayKey();

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-muted">{dateLabel}</p>
        <h1 className="text-2xl font-bold">
          {emoji} {name}，今天也来一局？
        </h1>
        <p className="text-sm text-muted">每天三域，各显所长。5 道题，3 分钟。</p>
      </header>

      {/* 今日挑战 */}
      <div className="panel space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted">今日挑战</div>
            <div className="mt-0.5 text-lg font-semibold">
              {domains.length > 0
                ? domains.map((d) => DOMAINS.find((x) => x.id === d)?.name).join(" · ")
                : "随缘三域"}
            </div>
          </div>
          <div className="text-right">
            <div className="tabular text-2xl font-bold text-accent">{streak}</div>
            <div className="text-xs text-muted">连续天数</div>
          </div>
        </div>

        <Link href="/daily">
          <Button block size="lg">
            开始今日挑战 →
          </Button>
        </Link>

        {domains.length === 0 && (
          <Link href="/domains" className="block text-center text-xs text-accent">
            先选三个本命领域 →
          </Link>
        )}
      </div>

      {/* 战绩速览 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="panel p-4">
          <div className="text-xs text-muted">最长连续</div>
          <div className="tabular mt-1 text-2xl font-bold">{best} 天</div>
        </div>
        <div className="panel p-4">
          <div className="text-xs text-muted">已选领域</div>
          <div className="tabular mt-1 text-2xl font-bold">{domains.length} / 3</div>
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/duel">
          <div className="panel p-4 transition-colors hover:border-accent/60">
            <div className="text-2xl">⚔️</div>
            <div className="mt-1 font-medium">同步抢答</div>
            <div className="text-xs text-muted">和朋友同题面抢答</div>
          </div>
        </Link>
        <Link href="/map">
          <div className="panel p-4 transition-colors hover:border-accent/60">
            <div className="text-2xl">🌌</div>
            <div className="mt-1 font-medium">知识星图</div>
            <div className="text-xs text-muted">看看你在哪些域更强</div>
          </div>
        </Link>
        <Link href="/wrong">
          <div className="panel p-4 transition-colors hover:border-accent/60">
            <div className="text-2xl">📕</div>
            <div className="mt-1 font-medium">错题本</div>
            <div className="text-xs text-muted">老朋友会再来找你</div>
          </div>
        </Link>
        <Link href="/history">
          <div className="panel p-4 transition-colors hover:border-accent/60">
            <div className="text-2xl">📊</div>
            <div className="mt-1 font-medium">战绩</div>
            <div className="text-xs text-muted">最近 30 场记录</div>
          </div>
        </Link>
      </div>

      {!persistent && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          ⚠️ 当前浏览器无法持久化存储（可能是隐私模式），本次进度不会保存。
        </div>
      )}
    </div>
  );
}

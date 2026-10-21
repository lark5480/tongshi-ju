"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Calendar,
  Check,
  GraduationCap,
  NotebookPen,
  Target,
  Timer,
} from "lucide-react";

import { domainColor, domainName } from "@/content/domains";
import { domainIcon } from "@/components/domain/DomainCard";
import { Button, buttonClass } from "@/components/ui/Button";
import { getWrongEntries } from "@/lib/storage";
import { GRADUATE_STREAK, dueEntries, isDue, masteryRatio } from "@/lib/engine/repetition";
import type { WrongEntry } from "@/types";

const DAY_MS = 86400000;

const DATE_FMT = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
});

interface DueInfo {
  /** 绝对日期，如「11月5日」。 */
  abs: string;
  /** 相对描述，如「3 天后」。 */
  rel: string;
  due: boolean;
}

/** 下次复习时间 → 人类可读的日期 + 相对描述（是否到期由引擎判定，不在这里重算）。 */
function dueInfo(entry: WrongEntry, now: number): DueInfo {
  const diff = entry.nextDueAt - now;
  const days = Math.ceil(diff / DAY_MS);
  let rel: string;
  if (diff <= 0) rel = "现在";
  else if (days <= 1) rel = "今天";
  else if (days <= 2) rel = "明天";
  else if (days <= 30) rel = `${days} 天后`;
  else rel = `${Math.round(days / 30)} 个月后`;
  return { abs: DATE_FMT.format(new Date(entry.nextDueAt)), rel, due: isDue(entry, now) };
}

/** 错题本：间隔重复队列 —— 什么时候该来、错过几次、连对进度。 */
export default function WrongPage() {
  const [entries, setEntries] = useState<WrongEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEntries(getWrongEntries());
    setReady(true);
  }, []);

  // 队列按「下次该来」的时间排序：到期的排前面，排队的按时间先后。
  // 「到期」这件事只由引擎的 isDue / dueEntries 判定，页面不自己比较时间戳。
  const { due, queued, now } = useMemo(() => {
    const now = Date.now();
    const dueList = dueEntries(entries, now).sort((a, b) => a.nextDueAt - b.nextDueAt);
    const dueIds = new Set(dueList.map((e) => e.questionId));
    const queuedList = entries
      .filter((e) => !dueIds.has(e.questionId))
      .sort((a, b) => a.nextDueAt - b.nextDueAt);
    return { due: dueList, queued: queuedList, now };
  }, [entries]);

  if (!ready) return null;

  if (entries.length === 0) {
    return (
      <div className="panel space-y-3 p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-gold">
          <NotebookPen size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <p className="font-medium">错题本还是空的</p>
        <p className="mx-auto max-w-sm text-sm text-muted">
          答错的题会自动进来，按 1 / 3 / 7 / 15 / 30 天计时。到期后可以点「开始复习」重做；
          答对推进间隔、连对 {GRADUATE_STREAK} 次毕业。
        </p>
        <Link href="/daily" className={buttonClass("primary", "md", false)}>
          <Target size={16} aria-hidden />
          去答一局
        </Link>
      </div>
    );
  }

  const ratio = Math.round(masteryRatio(entries) * 100);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <NotebookPen size={20} className="text-gold" aria-hidden />
          错题本
        </h1>
        <p className="text-sm text-muted">
          答错的题按间隔计时；到期后可以点「开始复习」重做，答对推进间隔、连对 {GRADUATE_STREAK}{" "}
          次毕业。队列只存在本机。
        </p>
      </header>

      {/* 队列速览 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Timer size={13} className="text-accent" aria-hidden />
            该复习
          </div>
          <div className="tabular mt-1 text-xl font-bold text-accent">{due.length}</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <GraduationCap size={13} className="text-success" aria-hidden />
            掌握度
          </div>
          <div className="tabular mt-1 text-xl font-bold">{ratio}%</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <NotebookPen size={13} className="text-info" aria-hidden />
            队列长度
          </div>
          <div className="tabular mt-1 text-xl font-bold">{entries.length}</div>
        </div>
      </div>

      {/* 该复习了 */}
      {due.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <h2 className="text-sm font-semibold">该复习了</h2>
            <span className="tabular ml-auto text-xs text-muted">{due.length} 题</span>
          </div>
          <Link href="/wrong/practice" className={buttonClass("primary", "md", true)}>
            <ArrowRight size={16} aria-hidden />
            开始复习 {due.length} 题
          </Link>
          {due.map((e) => (
            <WrongRow key={e.questionId} entry={e} now={now} />
          ))}
        </section>
      )}

      {/* 排队中 */}
      {queued.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-border-strong" aria-hidden />
            <h2 className="text-sm font-semibold">排队中</h2>
            <span className="tabular ml-auto text-xs text-muted">{queued.length} 题</span>
          </div>
          {queued.map((e) => (
            <WrongRow key={e.questionId} entry={e} now={now} />
          ))}
        </section>
      )}
    </div>
  );
}

/** 队列中的一道错题。 */
function WrongRow({ entry, now }: { entry: WrongEntry; now: number }) {
  const info = dueInfo(entry, now);
  const color = domainColor(entry.domain);
  const Icon = domainIcon(entry.domain);

  return (
    <div className="panel p-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-sm"
          style={{ background: `${color}22`, color }}
        >
          <Icon size={15} strokeWidth={2.1} />
        </span>
        <span className="truncate text-sm font-medium">{domainName(entry.domain)}</span>
        <span className="truncate text-xs text-muted">· {entry.topic}</span>
        <span className="tabular ml-auto shrink-0 text-xs text-muted">
          错 {entry.wrongCount} 次
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {/* 下次该来 */}
        <span className={info.due ? "font-semibold text-accent" : "text-muted"}>
          <Calendar size={12} className="mr-1 inline align-[-2px]" aria-hidden />
          {info.due ? "现在就该来" : `${info.abs} · ${info.rel}`}
        </span>

        {/* 连对进度 */}
        <span className="flex items-center gap-1 text-muted">
          <span className="flex items-center gap-0.5" aria-hidden>
            {Array.from({ length: GRADUATE_STREAK }, (_, i) => (
              <span
                key={i}
                className="star-dot"
                data-filled={i < entry.streak}
                style={i < entry.streak ? { background: color } : undefined}
              />
            ))}
          </span>
          {entry.streak >= GRADUATE_STREAK ? (
            <span className="flex items-center gap-1 font-semibold text-success">
              <Check size={12} aria-hidden />
              已毕业
            </span>
          ) : (
            <span className="tabular">
              连对 {entry.streak} / {GRADUATE_STREAK}
            </span>
          )}
        </span>

        <span className="tabular ml-auto text-dim">记忆系数 {entry.ease.toFixed(1)}</span>
      </div>
    </div>
  );
}

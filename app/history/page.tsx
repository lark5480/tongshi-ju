"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, Flame, Medal, Star, Target, TrendingUp, Trophy } from "lucide-react";

import { domainName } from "@/content/domains";
import { getHistory, getRankSnapshot } from "@/lib/storage";
import type { RankSnapshot } from "@/lib/engine/rank";
import type { HistoryEntry } from "@/types";

const CHART_W = 320;
const CHART_H = 130;
const PAD_TOP = 14;
const PAD_BOTTOM = 10;

/** 战绩：最近 30 场记录（每日挑战与对战）。 */
export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [rank, setRank] = useState<RankSnapshot | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setEntries(getHistory());
    setRank(getRankSnapshot());
    setReady(true);
  }, []);

  /** 按日期正序（存储是倒序存的），用于画趋势。 */
  const chronological = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries]
  );

  if (!ready) return null;

  if (entries.length === 0) {
    return (
      <div className="panel space-y-3 p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-success">
          <BarChart3 size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <p className="font-medium">还没有战绩</p>
        <p className="mx-auto max-w-sm text-sm text-muted">
          完成一次每日挑战就会出现在这里，最近 30 场都会留着。
        </p>
      </div>
    );
  }

  const totalScore = entries.reduce((s, e) => s + e.score, 0);
  const totalCorrect = entries.reduce((s, e) => s + e.correct, 0);
  const totalQuestions = entries.reduce((s, e) => s + e.total, 0);
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const bestCombo = entries.reduce((m, e) => Math.max(m, e.maxCombo), 0);

  // ---- 趋势图坐标 ----
  const scores = chronological.map((e) => e.score);
  const maxScore = Math.max(...scores, 1);
  const minScore = Math.min(...scores, 0);
  const span = Math.max(1, maxScore - minScore);
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const innerW = CHART_W - 12;

  const points = chronological.map((e, i) => {
    const x =
      chronological.length === 1 ? CHART_W / 2 : 6 + (i / (chronological.length - 1)) * innerW;
    const y = PAD_TOP + (1 - (e.score - minScore) / span) * plotH;
    return { x, y, score: e.score, date: e.date };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const baseY = CHART_H - PAD_BOTTOM;
  const areaPath = points.length
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${baseY} L ${points[0].x.toFixed(1)} ${baseY} Z`
    : "";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <BarChart3 size={20} className="text-success" aria-hidden />
          战绩
        </h1>
        <p className="text-sm text-muted">最近 {entries.length} 场</p>
      </header>

      {/* 段位 */}
      {rank && (
        <div className="panel space-y-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
            <Trophy size={13} className="text-gold" aria-hidden />
            通识段位
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[15px] font-semibold">{rank.tierName}</span>
            <span className="tabular text-xs text-muted">
              {rank.maxed ? "已达最高段位" : `距下一段还差 ${rank.nextGap}`}
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2"
            role="img"
            aria-label={`段位进度 ${Math.round(rank.progress * 100)}%`}
          >
            <div
              className="h-full w-full origin-left rounded-pill bg-gradient-to-r from-accent-soft to-accent transition-transform duration-base"
              style={{ transform: `scaleX(${rank.progress})` }}
            />
          </div>
          <p className="text-xs text-dim">{rank.tierBlurb}</p>
        </div>
      )}

      {/* 累计指标 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <TrendingUp size={13} className="text-accent" aria-hidden />
            近期得分
          </div>
          <div className="tabular mt-1 text-xl font-bold text-accent">{totalScore}</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Target size={13} className="text-info" aria-hidden />
            正确率
          </div>
          <div className="tabular mt-1 text-xl font-bold">{accuracy}%</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Medal size={13} className="text-gold" aria-hidden />
            累计答对
          </div>
          <div className="tabular mt-1 text-xl font-bold">{totalCorrect}</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Flame size={13} className="text-gold" aria-hidden />
            最高连击
          </div>
          <div className="tabular mt-1 text-xl font-bold">{bestCombo}</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <BarChart3 size={13} className="text-muted" aria-hidden />
            场次
          </div>
          <div className="tabular mt-1 text-xl font-bold">{entries.length}</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Target size={13} className="text-muted" aria-hidden />
            答对题数
          </div>
          <div className="tabular mt-1 text-xl font-bold">
            {totalCorrect}
            <span className="text-sm text-dim"> / {totalQuestions}</span>
          </div>
        </div>
      </div>

      {/* 分数趋势 */}
      <div className="panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
            <TrendingUp size={13} className="text-accent" aria-hidden />
            分数趋势
          </div>
          <span className="tabular text-xs text-muted">最高 {maxScore} 分</span>
        </div>

        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="mt-2 h-auto w-full"
          role="img"
          aria-label={`最近 ${entries.length} 场分数趋势，最高 ${maxScore} 分`}
        >
          {/* 基线 */}
          <line
            x1={0}
            y1={baseY}
            x2={CHART_W}
            y2={baseY}
            className="text-border"
            stroke="currentColor"
            strokeWidth={1}
          />

          {/* 面积 */}
          {areaPath && <path d={areaPath} className="fill-accent/10" />}

          {/* 折线 */}
          {points.length > 1 && (
            <path
              d={linePath}
              fill="none"
              className="text-accent"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* 数据点 */}
          {points.map((p, i) => (
            <circle
              key={`${p.date}-${i}`}
              cx={p.x.toFixed(1)}
              cy={p.y.toFixed(1)}
              r={i === points.length - 1 ? 4 : 2.5}
              className="text-accent"
              fill="currentColor"
            />
          ))}
        </svg>

        <div className="mt-1 flex items-center justify-between text-xs text-dim">
          <span className="tabular">{chronological[0]?.date}</span>
          <span>最近 {chronological[chronological.length - 1]?.date}</span>
        </div>
      </div>

      {/* 逐场记录 */}
      <div className="space-y-2">
        {entries.map((e, i) => (
          <div key={`${e.date}-${i}`} className="panel p-3">
            <div className="flex items-center gap-2">
              <span className="tabular text-sm font-medium">{e.date}</span>
              <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] text-muted">
                {e.mode === "daily" ? "每日" : "对战"}
              </span>
              <span className="ml-auto flex items-center gap-0.5" aria-label={`${e.stars} 星`}>
                {Array.from({ length: e.stars }, (_, k) => (
                  <Star
                    key={k}
                    size={13}
                    className="text-gold"
                    fill="currentColor"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                ))}
                {e.stars === 0 && <span className="text-[11px] text-dim">未评星</span>}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span className="tabular font-semibold text-accent">{e.score} 分</span>
              <span className="tabular">
                {e.correct} / {e.total} 题
              </span>
              {e.maxCombo >= 2 && (
                <span className="tabular flex items-center gap-1 text-gold">
                  <Flame size={12} aria-hidden />
                  {e.maxCombo} 连击
                </span>
              )}
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

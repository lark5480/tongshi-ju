"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Flame, Orbit, Star, Swords, Trophy } from "lucide-react";

import { useDailyChallenge } from "@/hooks/useDailyChallenge";
import { QuestionCard } from "@/components/quiz/QuestionCard";
import { KnowledgeChain, type ChainSlot } from "@/components/quiz/KnowledgeChain";
import { GhostBar } from "@/components/quiz/GhostBar";
import { ShareCard } from "@/components/result/ShareCard";
import { Button } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { getProfile, getRankSnapshot, getStreak } from "@/lib/storage";
import { ghostSourceLabel, ghostVerdictText } from "@/lib/engine/ghost";
import { dailyModeLabel } from "@/lib/engine/blindbox";
import { maxScore } from "@/lib/engine/scoring";
import type { RankSnapshot } from "@/lib/engine/rank";

const LIMIT_MS: Record<1 | 2 | 3, number> = { 1: 30_000, 2: 25_000, 3: 20_000 };

export default function DailyPage() {
  const c = useDailyChallenge();
  const [streak, setStreak] = useState(0);
  const [profileName, setProfileName] = useState("通识玩家");
  const [profileEmoji, setProfileEmoji] = useState("🧠");
  const [rank, setRank] = useState<RankSnapshot | null>(null);

  useEffect(() => {
    setStreak(getStreak().current);
    setRank(getRankSnapshot());
    const p = getProfile();
    setProfileName(p.name);
    setProfileEmoji(p.emoji);
  }, [c.finished]);

  if (c.loading) {
    // 骨架屏：结构稳定、不闪烁（无障碍指南的加载反馈要求）
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="h-4 w-40 animate-pulse rounded-pill bg-surface-2" />
        <div className="panel space-y-4 p-5">
          <div className="h-6 w-3/4 animate-pulse rounded-pill bg-surface-2" />
          <div className="h-4 w-full animate-pulse rounded-pill bg-surface-2" />
          <div className="h-4 w-5/6 animate-pulse rounded-pill bg-surface-2" />
          <div className="h-14 w-full animate-pulse rounded-md bg-surface-2" />
          <div className="h-14 w-full animate-pulse rounded-md bg-surface-2" />
        </div>
        <span className="sr-only">正在抽取今日题目</span>
      </div>
    );
  }

  if (c.error) {
    return (
      <div className="panel space-y-3 p-6 text-center">
        <p className="text-muted">{c.error}</p>
        <div className="flex justify-center gap-2">
          <Link href="/domains">
            <Button variant="secondary">换个领域</Button>
          </Link>
          <Button onClick={() => window.location.reload()}>重试</Button>
        </div>
      </div>
    );
  }

  const maxPossible = maxScore(c.questions.map((q) => q.difficulty));
  const correctCount = c.correctCount;

  // 知识链槽位：已答的题在前，未答的题在后
  const chainSlots: ChainSlot[] = c.questions.map((q, i) => {
    const rec = c.records[i];
    return {
      domain: q.domain,
      answered: Boolean(rec),
      correct: Boolean(rec?.correct),
    };
  });

  // ---- 结算视图 ----
  if (c.finished) {
    return (
      <div className="space-y-4">
        <div className="panel space-y-4 p-6 text-center">
          <div
            className="flex items-center justify-center gap-1"
            role="img"
            aria-label={`${c.stars} 星`}
          >
            {Array.from({ length: Math.max(1, c.stars) }, (_, i) => (
              <Star key={i} size={30} className="fill-gold text-gold" aria-hidden />
            ))}
          </div>
          <div>
            <div className="tabular text-4xl font-bold text-accent">{c.score}</div>
            <div className="mt-1 text-sm text-muted">
              答对 {correctCount} / {c.questions.length} 题 · 最高连击 {c.maxCombo}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {c.domains.map((d) => {
              const meta = DOMAINS.find((x) => x.id === d);
              return (
                <span
                  key={d}
                  className="rounded-pill px-2.5 py-1 text-xs"
                  style={{
                    background: `${meta?.color ?? "#8b93a1"}22`,
                    color: meta?.color ?? "#8b93a1",
                  }}
                >
                  {meta?.emoji} {meta?.name}
                </span>
              );
            })}
          </div>
          {streak > 0 && (
            <p className="flex items-center justify-center gap-1.5 text-sm text-muted">
              <Flame size={15} className="text-gold" aria-hidden />
              连续 <span className="tabular font-semibold text-accent">{streak}</span> 天
            </p>
          )}
        </div>

        {/* 影子对手：和过去的自己比 */}
        {c.verdict && (
          <div className="panel space-y-2 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
              影子对手
            </div>
            <div className="text-[15px] font-semibold">
              {c.verdict.kind === "beat" ? (
                <span className="text-success">{ghostVerdictText(c.verdict)}</span>
              ) : c.verdict.kind === "first" ? (
                <span className="text-gold">{ghostVerdictText(c.verdict)}</span>
              ) : (
                <span className="text-fg">{ghostVerdictText(c.verdict)}</span>
              )}
            </div>
            <p className="text-xs text-dim">{ghostSourceLabel(c.verdict)}</p>
          </div>
        )}

        {/* 通识段位 */}
        {rank && (
          <div className="panel space-y-2 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
              <Trophy size={13} className="text-gold" aria-hidden />
              通识段位
            </div>
            <div className="flex items-baseline justify-between">
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
                className="h-full w-full origin-left rounded-pill bg-gradient-to-r from-accent-soft to-accent"
                style={{ transform: `scaleX(${rank.progress})` }}
              />
            </div>
            <p className="text-xs text-dim">{rank.tierBlurb}</p>
          </div>
        )}

        {/* 逐题回顾 */}
        <div className="space-y-2">
          {c.records.map((r, i) => (
            <div key={r.questionId + i} className="panel p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={r.correct ? "text-success" : "text-danger"}>
                  {r.correct ? "✓" : "✗"}
                </span>
                <span className="text-muted">
                  {DOMAINS.find((d) => d.id === r.domain)?.name} · {r.topic}
                </span>
                <span className="tabular ml-auto text-muted">{r.points} 分</span>
              </div>
              <p className="mt-1.5 text-[15px] leading-[1.65] text-fg/75">{r.explanation}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Link href="/duel" className="flex-1">
            <Button block variant="secondary">
              <Swords size={16} aria-hidden />
              找朋友抢答
            </Button>
          </Link>
          <Link href="/map" className="flex-1">
            <Button block variant="secondary">
              <Orbit size={16} aria-hidden />
              看星图
            </Button>
          </Link>
        </div>

        <div className="panel space-y-3 p-4">
          <h2 className="font-semibold">分享成绩</h2>
          <ShareCard
            date={c.date}
            name={profileName}
            emoji={profileEmoji}
            domains={c.domains}
            score={c.score}
            correct={correctCount}
            total={c.questions.length}
            stars={c.stars}
            maxCombo={c.maxCombo}
            streak={streak}
          />
        </div>
      </div>
    );
  }

  // ---- 答题视图 ----
  const q = c.questions[c.index];
  if (!q) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">
          第 {c.index + 1} / {c.questions.length} 题
          <span className="ml-2 rounded-pill bg-surface-2 px-2 py-0.5 text-[11px]">
            {dailyModeLabel(c.mode)}
          </span>
        </span>
        <span className="tabular font-semibold text-accent">{c.score} 分</span>
      </div>

      <KnowledgeChain slots={chainSlots} combo={c.combo} />

      <GhostBar ghost={c.ghost} playerScore={c.score} maxPossible={maxPossible} />

      <QuestionCard
        question={q}
        picked={c.picked}
        submitted={c.submitted}
        remaining={c.remaining}
        limit={LIMIT_MS[q.difficulty]}
        onPick={c.toggleOption}
        onConfirm={c.submit}
      />

      {c.submitted && (
        <Button block size="lg" onClick={c.next}>
          {c.index + 1 < c.questions.length ? "下一题" : "查看结算"}
          <ArrowRight size={16} aria-hidden />
        </Button>
      )}
    </div>
  );
}

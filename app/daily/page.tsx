"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Flame,
  MessageCircle,
  Orbit,
  Sparkles,
  Star,
  Swords,
  Trophy,
} from "lucide-react";

import { useDailyChallenge } from "@/hooks/useDailyChallenge";
import { QuestionCard } from "@/components/quiz/QuestionCard";
import { KnowledgeChain, type ChainSlot } from "@/components/quiz/KnowledgeChain";
import { GhostBar } from "@/components/quiz/GhostBar";
import { ShareCard } from "@/components/result/ShareCard";
import { Button, buttonClass } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { domainIcon } from "@/components/domain/DomainCard";
import { getProfile, getRankSnapshot, getStreak, markPracticeResultSeen } from "@/lib/storage";
import { ghostSourceLabel, ghostVerdictText } from "@/lib/engine/ghost";
import { dailyModeLabel } from "@/lib/engine/blindbox";
import {
  DIFFICULTY_LIMIT_MS as LIMIT_MS,
  maxScore,
  PUBLIC_DAILY_COUNT,
} from "@/lib/engine/scoring";
import type { RankSnapshot } from "@/lib/engine/rank";

/**
 * 降级原因 → 玩家可读文案。
 *
 * 「未配置模型」是主动选择，「调用失败 / 超时」是故障 —— 两者不能混成一句
 * 「未接入模型：调用超时」，那会让玩家以为项目不支持模型。
 */
function degradedLabel(reason?: string): string {
  if (!reason) return "未配置模型，由确定性模板给出点评";
  if (reason.includes("未配置")) return "未配置模型，由确定性模板给出点评";
  return `模型调用失败，已降级为确定性模板：${reason}`;
}

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

  // 加练题埋点：结算页曝光（幂等，只写当日会话）。
  useEffect(() => {
    if (c.finished && c.questions.length > PUBLIC_DAILY_COUNT) {
      markPracticeResultSeen(c.date);
    }
  }, [c.finished, c.questions.length, c.date]);

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
          <Link href="/domains" className={buttonClass("secondary", "md", false)}>
            换个领域
          </Link>
          <Button onClick={() => window.location.reload()}>重试</Button>
        </div>
      </div>
    );
  }

  // 4+1 分轨：只有前 4 题计分，第 5 题是个人加练。
  const publicTotal = Math.min(PUBLIC_DAILY_COUNT, c.questions.length);
  const maxPossible = maxScore(c.questions.slice(0, PUBLIC_DAILY_COUNT).map((q) => q.difficulty));
  const correctCount = c.correctCount;
  const practiceQuestion = c.questions[PUBLIC_DAILY_COUNT];
  const practiceDomain = practiceQuestion
    ? (DOMAINS.find((d) => d.id === practiceQuestion.domain)?.name ?? "")
    : "";
  const hasPractice = c.questions.length > PUBLIC_DAILY_COUNT;

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
              公共题答对 {correctCount} / {publicTotal} 题 · 最高连击 {c.maxCombo}
            </div>
            {hasPractice && (
              <div className="mt-1 text-xs">
                {c.practiceCorrect === true ? (
                  <span className="text-success">
                    补上这道题，你的 {practiceDomain} 熟练度 +1 · 不计分，不改变排名与连击
                  </span>
                ) : c.practiceCorrect === false ? (
                  <span className="text-dim">
                    加练题答错了 · 不计分、不计排名，熟练度已记入错题本
                  </span>
                ) : (
                  <span className="text-dim">加练题跳过了 · 不计分，也不影响排名</span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {c.domains.map((d) => {
              const meta = DOMAINS.find((x) => x.id === d);
              const Glyph = domainIcon(d);
              return (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs"
                  style={{
                    background: `${meta?.color ?? "#8b93a1"}22`,
                    color: meta?.color ?? "#8b93a1",
                  }}
                >
                  <Glyph size={12} strokeWidth={2.2} aria-hidden />
                  {meta?.name}
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

        {/* 老师 NPC：记住你的薄弱域，给出今天该练什么 */}
        {c.npc && c.npc.commentary && (
          <div className="panel space-y-2 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
              <MessageCircle size={13} className="text-accent" aria-hidden />
              老师 NPC
            </div>
            <div className="text-[15px] font-semibold text-fg">{c.npc.commentary}</div>
            {c.npc.rationale && <p className="text-xs text-dim">{c.npc.rationale}</p>}
            {c.npc.degraded && (
              <p className="text-xs text-dim">（{degradedLabel(c.npc.degradedReason)}）</p>
            )}
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
                {r.practice && (
                  <span className="rounded-pill bg-surface-2 px-1.5 py-0.5 text-[11px] text-dim">
                    加练 · 不计分
                  </span>
                )}
                <span className="tabular ml-auto text-muted">
                  {r.practice ? "不计分" : `${r.points} 分`}
                </span>
              </div>
              <p className="mt-1.5 text-[15px] leading-[1.65] text-fg/75">{r.explanation}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Link href="/duel" className={buttonClass("secondary", "md", true)}>
            <Swords size={16} aria-hidden />
            找朋友抢答
          </Link>
          <Link href="/map" className={buttonClass("secondary", "md", true)}>
            <Orbit size={16} aria-hidden />
            看星图
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
            total={publicTotal}
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
  // 4+1 分轨：第 5 题固定在第 5 位，标记为个人加练（不参与计分与排序）。
  const isPracticeQuestion = c.index === PUBLIC_DAILY_COUNT;
  if (!q) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">
          {isPracticeQuestion ? (
            <>
              加练题
              <span className="ml-1 text-dim">
                （第 {c.index + 1} / {c.questions.length} 题）
              </span>
            </>
          ) : (
            <>
              第 {c.index + 1} / {c.questions.length} 题
              <span className="ml-2 rounded-pill bg-surface-2 px-2 py-0.5 text-[11px]">
                {dailyModeLabel(c.mode)}
              </span>
            </>
          )}
        </span>
        <span className="tabular font-semibold text-accent">{c.score} 分</span>
      </div>

      {isPracticeQuestion && (
        <div className="panel space-y-1 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
            <Sparkles size={13} className="text-accent" aria-hidden />
            你的加练题
          </div>
          {c.practiceReason && <p className="text-sm text-fg">{c.practiceReason}</p>}
          <p className="text-xs text-dim">这道题不计分、不计排名，答对会写进熟练度。</p>
        </div>
      )}

      <KnowledgeChain slots={chainSlots} combo={c.combo} />

      <GhostBar ghost={c.ghost} playerScore={c.score} maxPossible={maxPossible} />

      <QuestionCard
        question={q}
        picked={c.picked}
        submitted={c.submitted}
        remaining={c.remaining}
        limit={LIMIT_MS[q.difficulty]}
        onPick={c.toggleOption}
        onConfirm={() => c.submit()}
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

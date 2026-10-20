"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useDailyChallenge } from "@/hooks/useDailyChallenge";
import { QuestionCard } from "@/components/quiz/QuestionCard";
import { ShareCard } from "@/components/result/ShareCard";
import { Button } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { getProfile, getStreak } from "@/lib/storage";

const LIMIT_MS: Record<1 | 2 | 3, number> = { 1: 30_000, 2: 25_000, 3: 20_000 };

export default function DailyPage() {
  const c = useDailyChallenge();
  const [streak, setStreak] = useState(0);
  const [profileName, setProfileName] = useState("通识玩家");
  const [profileEmoji, setProfileEmoji] = useState("🧠");

  useEffect(() => {
    setStreak(getStreak().current);
    const p = getProfile();
    setProfileName(p.name);
    setProfileEmoji(p.emoji);
  }, [c.finished]);

  if (c.loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted">
        <span className="animate-pulse">正在抽取今日题目…</span>
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

  // ---- 结算视图 ----
  if (c.finished) {
    const correctCount = c.records.filter((r) => r.correct).length;
    return (
      <div className="space-y-4">
        <div className="panel space-y-4 p-6 text-center">
          <div className="text-4xl">{"⭐".repeat(Math.max(1, c.stars))}</div>
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
                  className="rounded-full px-2.5 py-1 text-xs"
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
            <p className="text-sm text-muted">
              🔥 连续 <span className="font-semibold text-accent">{streak}</span> 天
            </p>
          )}
        </div>

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
              <p className="mt-1.5 text-[#c9ced6]">{r.explanation}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Link href="/duel" className="flex-1">
            <Button block variant="secondary">
              ⚔️ 找朋友抢答
            </Button>
          </Link>
          <Link href="/map" className="flex-1">
            <Button block variant="secondary">
              🌌 看星图
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
        </span>
        <span className="tabular font-semibold text-accent">{c.score} 分</span>
      </div>

      {c.combo >= 2 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-accent/15 px-2.5 py-1 font-medium text-accent">
            🔥 {c.combo} 连击
          </span>
          <span className="text-muted">跨域连击加成中</span>
        </div>
      )}

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
          {c.index + 1 < c.questions.length ? "下一题 →" : "查看结算 →"}
        </Button>
      )}
    </div>
  );
}

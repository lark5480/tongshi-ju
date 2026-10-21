"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, GraduationCap, NotebookPen, RotateCcw } from "lucide-react";

import { QuestionCard } from "@/components/quiz/QuestionCard";
import { Button, buttonClass } from "@/components/ui/Button";
import { loadQuestionPool } from "@/lib/content/loader";
import { isCorrect } from "@/lib/engine/answer";
import { buildPracticeSet, PRACTICE_LIMIT, type PracticePick } from "@/lib/engine/practice";
import { GRADUATE_STREAK, dueEntries } from "@/lib/engine/repetition";
import { getWrongEntries, recordAttempt } from "@/lib/storage";

/**
 * 到期错题的独立练习流。
 *
 * 只推进错题间隔：不计分、不写战绩 / streak / lifetime / 段位 / 熟练度，
 * 也不参与每日挑战的题集抽取。
 */
export default function PracticePage() {
  const [picks, setPicks] = useState<PracticePick[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | string[]>("");
  const [submitted, setSubmitted] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [graduated, setGraduated] = useState(0);
  const [finished, setFinished] = useState(false);
  const [remainingDue, setRemainingDue] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const entries = getWrongEntries();
        const now = Date.now();
        const due = dueEntries(entries, now);
        const domains = Array.from(new Set(due.map((e) => e.domain)));
        const pool = domains.length > 0 ? await loadQuestionPool(domains) : {};
        if (cancelled) return;
        setPicks(buildPracticeSet(entries, pool, now, PRACTICE_LIMIT));
      } catch (e) {
        console.error("[practice] 题库加载失败：", e);
        if (cancelled) return;
        setLoadError(true);
        setPicks([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const current = picks?.[index] ?? null;

  const submit = useCallback(
    (explicit?: string | string[]) => {
      if (!current || submitted) return;
      const value = typeof explicit === "string" || Array.isArray(explicit) ? explicit : picked;
      const answerList = Array.isArray(value) ? value : [value];
      if (answerList.length === 0 || answerList.every((a) => !a)) return;

      const correct = isCorrect(current.question.type, current.question.answer, value);
      const graduatedNow = correct && current.entry.streak + 1 >= GRADUATE_STREAK;

      recordAttempt({
        questionId: current.question.id,
        domain: current.question.domain,
        topic: current.question.topic,
        correct,
        mastery: false,
        now: Date.now(),
      });

      setPicked(value);
      setSubmitted(true);
      if (correct) setCorrectCount((n) => n + 1);
      if (graduatedNow) setGraduated((n) => n + 1);
    },
    [current, submitted, picked]
  );

  const toggleOption = useCallback(
    (option: string) => {
      if (submitted || !current) return;
      if (current.question.type === "multi") {
        setPicked((prev) => {
          const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
          return list.includes(option) ? list.filter((o) => o !== option) : [...list, option];
        });
        return;
      }
      setPicked(option);
      submit(option);
    },
    [current, submitted, submit]
  );

  const next = useCallback(() => {
    if (!submitted || !picks) return;
    if (index + 1 < picks.length) {
      setIndex((i) => i + 1);
      setPicked("");
      setSubmitted(false);
      return;
    }
    setRemainingDue(dueEntries(getWrongEntries(), Date.now()).length);
    setFinished(true);
  }, [submitted, picks, index]);

  if (picks === null) {
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <div className="h-4 w-32 animate-pulse rounded-pill bg-surface-2" />
        <div className="panel space-y-4 p-5">
          <div className="h-6 w-3/4 animate-pulse rounded-pill bg-surface-2" />
          <div className="h-14 w-full animate-pulse rounded-md bg-surface-2" />
          <div className="h-14 w-full animate-pulse rounded-md bg-surface-2" />
        </div>
        <span className="sr-only">正在准备到期错题</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="panel space-y-3 p-8 text-center">
        <p className="font-medium">题库加载失败</p>
        <p className="text-sm text-muted">请稍后重试，或先回到错题本。</p>
        <Link href="/wrong" className={buttonClass("secondary", "md", false)}>
          返回错题本
        </Link>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="panel space-y-3 p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-accent">
          <NotebookPen size={26} strokeWidth={1.8} aria-hidden />
        </span>
        <p className="font-medium">没有到期的错题</p>
        <p className="text-sm text-muted">按间隔排队的题还没到复习时间，先去答一局吧。</p>
        <Link href="/wrong" className={buttonClass("secondary", "md", false)}>
          返回错题本
        </Link>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="space-y-4">
        <div className="panel space-y-3 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-surface-2 text-success">
            <GraduationCap size={26} strokeWidth={1.8} aria-hidden />
          </span>
          <h1 className="text-xl font-bold tracking-tight">复习完成</h1>
          <p className="text-sm text-muted">
            答对 <span className="tabular font-semibold text-fg">{correctCount}</span> /{" "}
            {picks.length} 题 · 毕业{" "}
            <span className="tabular font-semibold text-success">{graduated}</span> 题
          </p>
          <p className="text-xs text-dim">本次练习不计分，也不影响战绩与段位。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/wrong" className={buttonClass("primary", "md", true)}>
            返回错题本
          </Link>
          {remainingDue > 0 && (
            <Button variant="secondary" block onClick={() => window.location.reload()}>
              <RotateCcw size={15} aria-hidden />
              再复习一轮（还有 {remainingDue} 题）
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <NotebookPen size={20} className="text-accent" aria-hidden />
          错题复习
        </h1>
        <p className="text-sm text-muted">只推进错题间隔：不计分、不进战绩与段位。</p>
      </header>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">
          第 {index + 1} / {picks.length} 题
        </span>
        <span className="text-xs text-dim">连对 {GRADUATE_STREAK} 次毕业</span>
      </div>

      <QuestionCard
        question={current.question}
        picked={picked}
        submitted={submitted}
        remaining={0}
        limit={0}
        showTimer={false}
        onPick={toggleOption}
        onConfirm={() => submit()}
      />

      {submitted && (
        <Button block size="lg" onClick={next}>
          {index + 1 < picks.length ? "下一题" : "完成复习"}
          <ArrowRight size={16} aria-hidden />
        </Button>
      )}
    </div>
  );
}

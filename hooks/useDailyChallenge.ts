/**
 * 每日挑战 hook —— 纯客户端，零服务端状态。
 *
 * ## 为什么可以在客户端完成
 *
 * 题集 = `f(daySeed, domains, count)` 是**纯函数**，客户端与服务端跑同一份
 * `lib/engine/daily.ts`，输入相同则输出必然相同。因此每日挑战：
 * - 不需要任何服务端状态 → 可纯静态托管（云轨）；
 * - 同一天 + 同一组领域 → 全网同一份题 → 天然可比、可分享。
 *
 * 「今天」的日期由客户端用 `dayKey()` 计算 —— 该函数与服务端使用的是**同一份实现**
 * （统一按 `Asia/Shanghai`），因此两端结果一致。
 *
 * ## 计时
 *
 * 客户端本地计时只用于**显示**。每日挑战没有排行榜、不做服务端结算，
 * 因此不存在「改本地时间刷分」的收益（无全局排行榜可刷）。
 * 对战 duel 才是服务端权威计时（见 `lib/store/room.ts`）。
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DailySession, DomainId, Question } from "@/types";
import { DOMAINS } from "@/content/domains";
import { dayKey } from "@/lib/engine/date";
import { buildDailySet, pickRandomDomains } from "@/lib/engine/daily";
import { isCorrect } from "@/lib/engine/answer";
import {
  comboMultiplier,
  maxScore,
  nextCombo,
  roundPoints,
  starRating,
} from "@/lib/engine/scoring";
import { createWrongEntry, onCorrect, onWrong } from "@/lib/engine/repetition";
import { loadQuestionPool } from "@/lib/content/loader";
import {
  bumpStreak,
  getDailySession,
  getProfile,
  getWrongEntries,
  pushHistory,
  recordMastery,
  saveDailySession,
  saveProfile,
  saveWrongEntries,
} from "@/lib/storage";

/** 每题的作答限时（毫秒），与对战一致。 */
const LIMIT_MS: Record<1 | 2 | 3, number> = { 1: 30_000, 2: 25_000, 3: 20_000 };

export interface AnswerRecord {
  questionId: string;
  domain: DomainId;
  topic: string;
  difficulty: 1 | 2 | 3;
  correct: boolean;
  elapsed: number;
  points: number;
  combo: number;
  picked: string | string[];
  answer: string | string[];
  explanation: string;
}

export interface DailyChallengeState {
  loading: boolean;
  error: string | null;
  date: string;
  domains: DomainId[];
  questions: Question[];
  index: number;
  /** 当前题的已选答案（多选题用于暂存）。 */
  picked: string | string[];
  /** 已提交？ */
  submitted: boolean;
  records: AnswerRecord[];
  score: number;
  combo: number;
  maxCombo: number;
  finished: boolean;
  stars: number;
  /** 当前题剩余毫秒。 */
  remaining: number;
  start: () => void;
  toggleOption: (option: string) => void;
  submit: () => void;
  next: () => void;
  reset: () => void;
}

export function useDailyChallenge(): DailyChallengeState {
  const date = useMemo(() => dayKey(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domains, setDomains] = useState<DomainId[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | string[]>("");
  const [submitted, setSubmitted] = useState(false);
  const [records, setRecords] = useState<AnswerRecord[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [finished, setFinished] = useState(false);
  const [stars, setStars] = useState(0);
  const [remaining, setRemaining] = useState(LIMIT_MS[1]);

  /** 本题开始时刻（本地，仅用于显示与速度分）。 */
  const startedAtRef = useRef<number>(0);
  /** 上一题抢先答对的领域（跨域连击判定）。 */
  const lastWinDomainRef = useRef<DomainId | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ---- 初始化：确定领域 → 抽题 → 锁定当日题集 ----
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const profile = getProfile();
        let useDomains = profile.domains;

        if (useDomains.length === 0) {
          // 「不选也行」：按当日种子确定性地随机 3 个已上线领域
          const enabled = DOMAINS.filter((d) => d.enabled).map((d) => d.id);
          useDomains = pickRandomDomains(date, enabled, 3);
          saveProfile({ domains: useDomains });
        }

        if (cancelled) return;
        setDomains(useDomains);

        // 当日题集已锁定 → 直接复用
        const existing = getDailySession(date);
        if (existing && existing.questionIds.length > 0) {
          const pool = await loadQuestionPool(useDomains);
          const byId = new Map<string, Question>();
          for (const list of Object.values(pool)) {
            for (const q of list ?? []) byId.set(q.id, q);
          }
          const qs = existing.questionIds.map((id) => byId.get(id)).filter(Boolean) as Question[];
          if (qs.length > 0) {
            setQuestions(qs);
            if (existing.done) {
              setFinished(true);
              setScore(existing.score ?? 0);
              setStars(existing.stars ?? 0);
              setMaxCombo(existing.maxCombo ?? 0);
              setRecords([]);
            } else {
              setIndex(0);
            }
            setLoading(false);
            return;
          }
        }

        // 抽题并锁定
        const pool = await loadQuestionPool(useDomains);
        const picks = buildDailySet({ dateKey: date, domains: useDomains, pool });
        if (picks.length === 0) {
          setError("所选领域的题库还在准备中，请稍后再试或换个领域");
          setLoading(false);
          return;
        }
        const qs = picks.map((p) => p.question);
        setQuestions(qs);
        const session: DailySession = {
          date,
          domains: useDomains,
          questionIds: qs.map((q) => q.id),
          done: false,
        };
        saveDailySession(session);
        setLoading(false);
      } catch (e) {
        console.error("[daily] 初始化失败：", e);
        if (!cancelled) {
          setError("题库加载失败，请刷新重试");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [date]);

  // ---- 计时器（K-003：双路清理） ----
  useEffect(() => {
    clearTimer();
    if (loading || finished || submitted) return;
    const q = questions[index];
    if (!q) return;
    const limit = LIMIT_MS[q.difficulty];
    startedAtRef.current = Date.now();
    setRemaining(limit);
    timerRef.current = setInterval(() => {
      const left = limit - (Date.now() - startedAtRef.current);
      setRemaining(Math.max(0, left));
    }, 100);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [index, questions, loading, finished, submitted, clearTimer]);

  const current = questions[index] ?? null;

  /** 提交当前题。 */
  const submit = useCallback(() => {
    if (!current || submitted) return;
    const limit = LIMIT_MS[current.difficulty];
    const elapsed = Math.min(limit, Date.now() - startedAtRef.current);
    const answerList = Array.isArray(picked) ? picked : [picked];
    if (answerList.length === 0 || answerList.every((a) => !a)) return;

    const correct = isCorrect(current.type, current.answer, picked);
    // 跨域连击：只在跨域时增长，同域不增长也不清零；答错清零
    const nextComboValue = correct
      ? nextCombo(combo, true, lastWinDomainRef.current, current.domain)
      : 0;
    const points = correct ? roundPoints(current.difficulty, elapsed, limit, combo) : 0;

    const record: AnswerRecord = {
      questionId: current.id,
      domain: current.domain,
      topic: current.topic,
      difficulty: current.difficulty,
      correct,
      elapsed,
      points,
      combo: nextComboValue,
      picked,
      answer: current.answer,
      explanation: current.explanation,
    };

    if (correct) lastWinDomainRef.current = current.domain;

    setRecords((prev) => [...prev, record]);
    setScore((s) => s + points);
    setCombo(nextComboValue);
    setMaxCombo((m) => Math.max(m, nextComboValue));
    setSubmitted(true);

    // 熟练度
    recordMastery(current.domain, current.topic, correct);

    // 错题本
    const entries = getWrongEntries();
    const existing = entries.find((e) => e.questionId === current.id);
    if (!correct) {
      const next = existing
        ? onWrong(existing, Date.now())
        : createWrongEntry({
            questionId: current.id,
            domain: current.domain,
            topic: current.topic,
            now: Date.now(),
          });
      saveWrongEntries([...entries.filter((e) => e.questionId !== current.id), next]);
    } else if (existing) {
      const next = onCorrect(existing, Date.now());
      saveWrongEntries(
        next === null
          ? entries.filter((e) => e.questionId !== current.id)
          : [...entries.filter((e) => e.questionId !== current.id), next]
      );
    }
  }, [current, picked, submitted, combo]);

  /** 进入下一题；最后一题则结算。 */
  const next = useCallback(() => {
    if (!submitted) return;
    if (index + 1 < questions.length) {
      setIndex((i) => i + 1);
      setPicked("");
      setSubmitted(false);
      return;
    }
    // 结算
    const finalScore = score;
    const max = maxScore(questions.map((q) => q.difficulty));
    const rating = starRating(finalScore, max);
    setStars(rating);
    setFinished(true);

    const session = getDailySession(date);
    const correctCount = records.filter((r) => r.correct).length;
    saveDailySession({
      date,
      domains,
      questionIds: questions.map((q) => q.id),
      done: true,
      score: finalScore,
      correct: correctCount,
      stars: rating,
      maxCombo,
    });
    bumpStreak(date);
    pushHistory({
      date,
      domains,
      score: finalScore,
      correct: correctCount,
      total: questions.length,
      stars: rating,
      maxCombo,
      mode: "daily",
    });
    void session;
  }, [submitted, index, questions, score, records, date, domains, maxCombo]);

  /** 多选题：切换选项暂存；单选/判断题：直接提交。 */
  const toggleOption = useCallback(
    (option: string) => {
      if (submitted || !current) return;
      if (current.type === "multi") {
        setPicked((prev) => {
          const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
          return list.includes(option) ? list.filter((o) => o !== option) : [...list, option];
        });
        return;
      }
      setPicked(option);
      // 单选立即提交：用 setTimeout 等待 picked 状态生效
      setTimeout(() => submit(), 0);
    },
    [current, submitted, submit]
  );

  /** 重做今日挑战（仅用于解锁错题变体等场景）。 */
  const reset = useCallback(() => {
    setIndex(0);
    setPicked("");
    setSubmitted(false);
    setRecords([]);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setFinished(false);
    setStars(0);
  }, []);

  return {
    loading,
    error,
    date,
    domains,
    questions,
    index,
    picked,
    submitted,
    records,
    score,
    combo,
    maxCombo,
    finished,
    stars,
    remaining,
    start: reset,
    toggleOption,
    submit,
    next,
    reset,
  };
}

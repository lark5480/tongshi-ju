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
import { buildDailySet } from "@/lib/engine/daily";
import { isCorrect } from "@/lib/engine/answer";
import {
  comboMultiplier,
  maxScore,
  nextCombo,
  roundPoints,
  starRating,
} from "@/lib/engine/scoring";
import { createWrongEntry, onCorrect, onWrong } from "@/lib/engine/repetition";
import {
  compareWithGhost,
  ghostKey,
  updateGhost,
  type GhostRecord,
  type GhostVerdict,
} from "@/lib/engine/ghost";
import { resolveDailyDomains, type DailyMode } from "@/lib/engine/blindbox";
import { loadQuestionPool } from "@/lib/content/loader";
import {
  bumpLifetimeStats,
  bumpStreak,
  getDailySession,
  getGhost,
  getProfile,
  getWrongEntries,
  pushHistory,
  recordMastery,
  saveDailySession,
  saveGhost,
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
  /**
   * 本局答对题数。
   *
   * 独立于 `records` —— 刷新页面后 `records` 为空（逐题明细不落盘），
   * 但答对数是**持久化**的（`DailySession.correct`），结算页必须显示它，
   * 否则刷新一次就会变成"答对 0 / 5 题"。
   */
  correctCount: number;
  score: number;
  combo: number;
  maxCombo: number;
  finished: boolean;
  stars: number;
  /** 当前题剩余毫秒。 */
  remaining: number;
  /** 本局使用的领域模式。 */
  mode: DailyMode;
  /** 本局领域集合对应的「过去的自己」。 */
  ghost: GhostRecord | null;
  /** 结算后与影子的对比结论；未结算为 null。 */
  verdict: GhostVerdict | null;
  start: () => void;
  toggleOption: (option: string) => void;
  /**
   * 提交当前题。
   *
   * `answer` 可选：单选/判断题在点击的同一帧调用，**必须**把答案带进来 ——
   * 此时 `picked` state 还没生效，闭包里读到的仍是旧值。
   */
  submit: (answer?: string | string[]) => void;
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
  const [correctCount, setCorrectCount] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [finished, setFinished] = useState(false);
  const [stars, setStars] = useState(0);
  const [remaining, setRemaining] = useState(LIMIT_MS[1]);
  const [mode, setMode] = useState<DailyMode>("native");
  const [ghost, setGhost] = useState<GhostRecord | null>(null);
  const [verdict, setVerdict] = useState<GhostVerdict | null>(null);

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
        const enabled = DOMAINS.filter((d) => d.enabled).map((d) => d.id);

        // 三种领域模式（见 lib/engine/blindbox.ts）：
        // - native   本命模式：玩家选定的领域
        // - blindbox 盲盒轮转：1 个本命 + 2 个每日盲盒（每日换新）
        // - random   随缘开局：完全按日期种子取 3 个
        //
        // ⚠️ random 模式**不写回档案**：写回会让第二天起不再轮换，
        // 「随缘」会退化成固定领域（那正是本模块修掉的一个老 bug）。
        const dailyMode: DailyMode = profile.blindbox
          ? "blindbox"
          : profile.domains.length > 0
            ? "native"
            : "random";

        // 当日题集若已锁定，领域以 session 为准 —— 改领域不影响当天已抽的题。
        const existing = getDailySession(date);
        const locked = existing && existing.questionIds.length > 0 ? existing : null;

        const useDomains: DomainId[] = locked
          ? locked.domains
          : resolveDailyDomains({
              dateKey: date,
              native: profile.domains,
              blindbox: profile.blindbox,
              candidates: enabled,
            });

        if (cancelled) return;
        setMode(locked?.mode ?? dailyMode);
        setDomains(useDomains);
        setGhost(getGhost(ghostKey(useDomains)));

        if (locked) {
          const pool = await loadQuestionPool(useDomains);
          const byId = new Map<string, Question>();
          for (const list of Object.values(pool)) {
            for (const q of list ?? []) byId.set(q.id, q);
          }
          const qs = locked.questionIds.map((id) => byId.get(id)).filter(Boolean) as Question[];
          if (qs.length > 0) {
            setQuestions(qs);
            if (locked.done) {
              setFinished(true);
              setScore(locked.score ?? 0);
              setStars(locked.stars ?? 0);
              setMaxCombo(locked.maxCombo ?? 0);
              setRecords([]);
              setCorrectCount(locked.correct ?? 0);
              // 已完成的一局：直接给出与影子的对比结论
              setVerdict(compareWithGhost(locked.score ?? 0, getGhost(ghostKey(useDomains))));
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
          mode: dailyMode,
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

  /**
   * 提交当前题。
   *
   * `explicit` 让调用方**直接带上答案**。
   *
   * ## 为什么必须这样
   *
   * 单选/判断题在点击的**同一帧**就要提交。此时 `setPicked` 触发的重渲染
   * 还没发生，`submit` 闭包里的 `picked` 仍然是旧值（空串）——
   * 直接读 state 会命中「答案为空」分支**静默 return**，
   * 表现为「点了选项却毫无反应」：分数不动、不给反馈、不进下一题。
   *
   * 答案跟着调用走，就不依赖任何时序。
   */
  const submit = useCallback(
    (explicit?: string | string[]) => {
      if (!current || submitted) return;
      const limit = LIMIT_MS[current.difficulty];
      const elapsed = Math.min(limit, Date.now() - startedAtRef.current);
      const value = explicit ?? picked;
      const answerList = Array.isArray(value) ? value : [value];
      if (answerList.length === 0 || answerList.every((a) => !a)) return;

      const correct = isCorrect(current.type, current.answer, value);
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
        picked: value,
        answer: current.answer,
        explanation: current.explanation,
      };

      if (correct) lastWinDomainRef.current = current.domain;

      setRecords((prev) => [...prev, record]);
      setScore((s) => s + points);
      if (correct) setCorrectCount((n) => n + 1);
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
    },
    [current, picked, submitted, combo]
  );

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

    // ---- 影子对手：用本局成绩刷新"过去的自己" ----
    // 对比的是**本局开始前**的影子：先算结论，再更新影子，否则等于自己跟自己比。
    const key = ghostKey(domains);
    const prevGhost = getGhost(key);
    const totalElapsed = records.reduce((sum, r) => sum + r.elapsed, 0);
    saveGhost(
      updateGhost(prevGhost, {
        key,
        score: finalScore,
        correct: correctCount,
        date,
        elapsed: totalElapsed,
      })
    );
    setVerdict(compareWithGhost(finalScore, prevGhost));

    // ---- 生涯累计（段位用，不受 30 场历史窗口影响） ----
    bumpLifetimeStats({ correct: correctCount, stars: rating, maxCombo });

    saveDailySession({
      date,
      domains,
      questionIds: questions.map((q) => q.id),
      done: true,
      score: finalScore,
      correct: correctCount,
      stars: rating,
      maxCombo,
      mode,
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
  }, [submitted, index, questions, score, records, date, domains, maxCombo, mode]);

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
      // 单选立即提交：答案跟着调用走，不依赖 setPicked 的重渲染时序
      submit(option);
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
    correctCount,
    score,
    combo,
    maxCombo,
    finished,
    stars,
    remaining,
    mode,
    ghost,
    verdict,
    start: reset,
    toggleOption,
    submit,
    next,
    reset,
  };
}

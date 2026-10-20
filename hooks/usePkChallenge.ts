/**
 * 同题 PK —— 客户端 hook，纯本地、零服务端。
 *
 * ## 为什么 PK 不需要服务端
 *
 * 题目由 `f(pkSeed(dateKey, code), domains, count)` 决定，是**纯函数**。
 * 两个人输入同一个码，各自本地跑一遍，得到**完全相同**的 5 道题。
 * 双方各自作答、各自计时、各自算分，最后互相比较成绩卡。
 *
 * 代价与边界（诚实地说明）：
 * - 没有实时同步 —— 双方不是同时开抢，而是"同题、各自跑、最后比"；
 * - 没有自动判胜 —— 成绩要靠成绩卡（带 PK 码）线下对照；
 * - 换设备不互通（没有账号体系），但**换设备也能玩**：只要码一样，题就一样。
 *
 * ## 与每日挑战的分工
 *
 * - 每日挑战：和**自己**比（影子对手）、计入 streak 与段位；
 * - PK：和**别人**比同一份题，不计入 streak 与段位（避免刷分）。
 * - 两者都会更新熟练度与错题本 —— 学到的东西是同一批。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { DomainId, Question } from "@/types";
import { DOMAINS } from "@/content/domains";
import { dayKey } from "@/lib/engine/date";
import { buildDailySet } from "@/lib/engine/daily";
import { isCorrect } from "@/lib/engine/answer";
import { comboMultiplier, nextCombo, roundPoints } from "@/lib/engine/scoring";
import { createWrongEntry, onCorrect, onWrong } from "@/lib/engine/repetition";
import {
  dailyPkCode,
  isValidPkCode,
  normalizePkCode,
  resolvePkSpec,
  type PkSpec,
} from "@/lib/engine/pk";
import { loadQuestionPool } from "@/lib/content/loader";
import { getWrongEntries, recordMastery, saveWrongEntries } from "@/lib/storage";

/** 每题的作答限时（毫秒），与每日挑战一致。 */
const LIMIT_MS: Record<1 | 2 | 3, number> = { 1: 30_000, 2: 25_000, 3: 20_000 };

export interface PkRecord {
  questionId: string;
  domain: DomainId;
  topic: string;
  correct: boolean;
  elapsed: number;
  points: number;
  combo: number;
}

export interface PkState {
  loading: boolean;
  error: string | null;
  /** 当前输入 / 使用的 PK 码。 */
  code: string;
  /** 今日推荐码。 */
  suggested: string;
  /** 本局规格（领域 + 种子）。 */
  spec: PkSpec | null;
  questions: Question[];
  index: number;
  picked: string | string[];
  submitted: boolean;
  records: PkRecord[];
  score: number;
  combo: number;
  maxCombo: number;
  finished: boolean;
  remaining: number;
  setCode: (code: string) => void;
  start: () => void;
  toggleOption: (option: string) => void;
  /** 提交当前题；`answer` 可选（单选/判断题需在同一帧把答案带进来）。 */
  submit: (answer?: string | string[]) => void;
  next: () => void;
  reset: () => void;
}

export function usePkChallenge(): PkState {
  const date = useRef(dayKey()).current;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [suggested] = useState(() => dailyPkCode(date));
  const [spec, setSpec] = useState<PkSpec | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | string[]>("");
  const [submitted, setSubmitted] = useState(false);
  const [records, setRecords] = useState<PkRecord[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [finished, setFinished] = useState(false);
  const [remaining, setRemaining] = useState(LIMIT_MS[1]);

  const startedAtRef = useRef<number>(0);
  const lastWinDomainRef = useRef<DomainId | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ---- 计时器（与每日挑战同构） ----
  useEffect(() => {
    clearTimer();
    if (loading || finished || submitted || questions.length === 0) return;
    const q = questions[index];
    if (!q) return;
    const limit = LIMIT_MS[q.difficulty];
    startedAtRef.current = Date.now();
    setRemaining(limit);
    timerRef.current = setInterval(() => {
      setRemaining(Math.max(0, limit - (Date.now() - startedAtRef.current)));
    }, 100);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [index, questions, loading, finished, submitted, clearTimer]);

  const current = questions[index] ?? null;

  /** 开始一局：按「日期 + 码」推出规格并抽题。 */
  const start = useCallback(() => {
    const normalized = normalizePkCode(code);
    if (!isValidPkCode(normalized)) {
      setError("PK 码需要 4–6 位字母或数字");
      return;
    }
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        const enabled = DOMAINS.filter((d) => d.enabled).map((d) => d.id);
        const resolved = resolvePkSpec(date, normalized, enabled, 3);
        const pool = await loadQuestionPool(resolved.domains);
        const picks = buildDailySet({
          dateKey: date,
          domains: resolved.domains,
          pool,
          seed: resolved.seed,
        });
        if (picks.length === 0) {
          setError("题库加载失败，请稍后重试");
          setLoading(false);
          return;
        }
        setSpec(resolved);
        setQuestions(picks.map((p) => p.question));
        setIndex(0);
        setPicked("");
        setSubmitted(false);
        setRecords([]);
        setScore(0);
        setCombo(0);
        setMaxCombo(0);
        setFinished(false);
        setLoading(false);
      } catch (e) {
        console.error("[pk] 初始化失败：", e);
        setError("题库加载失败，请刷新重试");
        setLoading(false);
      }
    })();
  }, [code, date]);

  /**
   * 提交当前题。
   *
   * `explicit` 让调用方直接带上答案 —— 单选/判断题在点击的**同一帧**就要提交，
   * 此时 `picked` state 还没生效，闭包里读到的仍是旧值（空串），
   * 直接读 state 会静默 return，表现为「点了选项却毫无反应」。
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
      const nextComboValue = correct
        ? nextCombo(combo, true, lastWinDomainRef.current, current.domain)
        : 0;
      const points = correct ? roundPoints(current.difficulty, elapsed, limit, combo) : 0;

      if (correct) lastWinDomainRef.current = current.domain;

      setRecords((prev) => [
        ...prev,
        {
          questionId: current.id,
          domain: current.domain,
          topic: current.topic,
          correct,
          elapsed,
          points,
          combo: nextComboValue,
        },
      ]);
      setScore((s) => s + points);
      setCombo(nextComboValue);
      setMaxCombo((m) => Math.max(m, nextComboValue));
      setSubmitted(true);

      // 熟练度与错题本：PK 学到的和每日学到的是同一批
      recordMastery(current.domain, current.topic, correct);
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
    setFinished(true);
  }, [submitted, index, questions]);

  /** 多选题切换暂存；单选/判断题直接提交。 */
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

  /** 回到大厅（保留当前码）。 */
  const reset = useCallback(() => {
    setSpec(null);
    setQuestions([]);
    setIndex(0);
    setPicked("");
    setSubmitted(false);
    setRecords([]);
    setScore(0);
    setCombo(0);
    setMaxCombo(0);
    setFinished(false);
    setError(null);
  }, []);

  /** 读取本地档案里的本命领域 —— 仅用于给 PK 页面做"今天常玩什么"的提示。 */
  return {
    loading,
    error,
    code,
    suggested,
    spec,
    questions,
    index,
    picked,
    submitted,
    records,
    score,
    combo,
    maxCombo,
    finished,
    remaining,
    setCode,
    start,
    toggleOption,
    submit,
    next,
    reset,
  };
}

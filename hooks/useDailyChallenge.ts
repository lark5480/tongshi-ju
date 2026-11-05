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

import type { DailySession, DomainId, PracticeFunnel, Question } from "@/types";
import { DOMAINS } from "@/content/domains";
import { dayKey } from "@/lib/engine/date";
import { buildDailySet, dailySeed } from "@/lib/engine/daily";
import { isCorrect } from "@/lib/engine/answer";
import {
  comboMultiplier,
  // 限时口径唯一来源在服务端共用的引擎里 —— 客户端不再抄一份数字表
  DIFFICULTY_LIMIT_MS as LIMIT_MS,
  maxScore,
  nextCombo,
  PUBLIC_DAILY_COUNT,
  roundPoints,
  SCORING_VERSION,
  settlePublicAnswers,
  starRating,
} from "@/lib/engine/scoring";
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
  getComparableGhost,
  getDailySession,
  getHistory,
  getMastery,
  getProfile,
  getWrongEntries,
  pushHistory,
  recordAttempt,
  saveDailyNpc,
  saveDailySession,
  saveGhost,
  saveProfile,
  updatePracticeFunnel,
} from "@/lib/storage";
import {
  buildCoachContext,
  buildPendingDecision,
  loadCoachEpisodes,
  recordCoachEvent,
  requestCoach,
} from "@/lib/npc/client";
import { buildAnswerEvent, pickPracticeQuestion, resolveCommentaryStatus } from "@/lib/npc";
import type { NpcContext, NpcDecision } from "@/lib/npc/types";

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
  /** 是否为第 5 题（个人加练，不计分）。 */
  practice: boolean;
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
   * 本局**公共题**答对题数（前 4 题）。
   *
   * 独立于 `records` —— 刷新页面后 `records` 为空（逐题明细不落盘），
   * 但答对数是**持久化**的（`DailySession.correct`），结算页必须显示它，
   * 否则刷新一次就会变成"答对 0 / 4 题"。
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
  /**
   * 老师 NPC 的决策结果（含点评、领域权重与依据）。
   *
   * `null` 表示 NPC 还没给出点评（题库未加载完成 / 无本地事实）。
   * 4+1 分轨：前 4 题全网同题并计分；NPC 只影响**第 5 题**的选题，
   * 以及「该练什么」的点评（见 `lib/npc/`）。
   */
  npc: NpcDecision | null;
  /** 第 5 题（个人加练）的选题依据；`null` 表示今天没有加练题。 */
  practiceReason: string | null;
  /** 加练题是否答对（未作答为 `null`）。 */
  practiceCorrect: boolean | null;
  /** 加练题是否被主动跳过（跳过不惩罚，也不记作答）。 */
  practiceSkipped: boolean;
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
  /**
   * 跳过第 5 题加练，直接进入结算。
   *
   * 仅在「当前是加练题且尚未提交」时有效；跳过不惩罚、不计分，
   * 漏斗里记 `skipped` 而不是 `answered`。
   */
  skipPractice: () => void;
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
  const [npc, setNpc] = useState<NpcDecision | null>(null);
  const [practiceReason, setPracticeReason] = useState<string | null>(null);
  const [practiceCorrect, setPracticeCorrect] = useState<boolean | null>(null);
  const [practiceSkipped, setPracticeSkipped] = useState(false);

  /** 本题开始时刻（本地，仅用于显示与速度分）。 */
  const startedAtRef = useRef<number>(0);
  /** 上一题抢先答对的领域（跨域连击判定）。 */
  const lastWinDomainRef = useRef<DomainId | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * 点评请求序号。
   *
   * 开局那次请求可能比结算后那次更晚返回（模型耗时波动），
   * 没有闸门就会用「一题未答」的旧统计覆盖结算复盘。
   */
  const npcSeqRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * 按**最新事实**重新生成点评并覆盖当日会话。
   *
   * 分两步，保证「结算页不空白、且说出的是最新成绩」：
   * 1. **同步**用最新事实生成模板，标 `pending` 并立刻落盘（毫秒级可见）；
   * 2. 模型返回后再覆盖为 `model` / `degraded` 并落盘（刷新读到最终结果）。
   *
   * 开局那份点评的事实是「一题未答」；结算后必须重算，否则面板会拿开局
   * 的统计冒充当前成绩。
   */
  const refreshNpc = useCallback(async () => {
    if (domains.length === 0) return;
    const seq = ++npcSeqRef.current;
    try {
      const profile = getProfile();
      const context = buildCoachContext({
        userId: profile.name,
        domains,
        pool: {},
        mastery: getMastery(),
        wrongEntries: getWrongEntries().map((e) => ({
          domain: e.domain,
          wrongCount: e.wrongCount,
        })),
        history: getHistory().map((h) => ({
          domains: h.domains,
          correct: h.correct,
          total: h.total,
        })),
        seed: dailySeed(date, domains),
        now: Date.now(),
      });

      // ---- 1) 模板先行：同步展示（三态 = pending），不是降级 ----
      const pending = buildPendingDecision(context);
      setNpc(pending);
      saveDailyNpc(date, pending);

      // ---- 2) 模型回来后再替换 ----
      const result = await requestCoach({
        userId: profile.name,
        domains,
        facts: context.facts,
        episodes: context.episodes,
        seed: dailySeed(date, domains),
        now: context.now,
      });
      // 已有更新的请求（例如刷新重建）→ 这次结果作废，不能覆盖新统计。
      if (seq !== npcSeqRef.current) return;
      setNpc(result.decision);
      saveDailyNpc(date, result.decision);
    } catch (error) {
      // NPC 是增强：复盘失败不应影响结算结果。
      console.warn("[daily] NPC 复盘不可用：", error);
    }
  }, [date, domains]);

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
        // 影子只展示同口径的基准：旧口径（5 题）记录不与 4 题成绩混比。
        setGhost(getComparableGhost(ghostKey(useDomains)));

        /** 用当前本地事实构造 NPC 上下文；失败返回 null（第 5 题回落公共题）。 */
        const makeContext = (pool: Partial<Record<DomainId, Question[]>>): NpcContext | null => {
          try {
            return buildCoachContext({
              userId: profile.name,
              domains: useDomains,
              pool,
              mastery: getMastery(),
              wrongEntries: getWrongEntries().map((e) => ({
                domain: e.domain,
                wrongCount: e.wrongCount,
              })),
              history: getHistory().map((h) => ({
                domains: h.domains,
                correct: h.correct,
                total: h.total,
              })),
              seed: dailySeed(date, useDomains),
              now: Date.now(),
            });
          } catch (error) {
            console.warn("[daily] NPC 上下文不可用，第 5 题回落公共题：", error);
            return null;
          }
        };

        /**
         * 请求点评并**写回当日会话**。
         *
         * 同样先同步展示模板（`pending`），模型回来再替换 —— 开局也不留空白面板。
         * 只 setNpc 不落盘的话，刷新 / 再次进入锁定会话点评就会消失
         * （含三态与降级原因）。
         */
        const requestNpc = async (coachContext: NpcContext | null) => {
          if (!coachContext) return;
          const seq = ++npcSeqRef.current;
          try {
            const pending = buildPendingDecision(coachContext);
            setNpc(pending);
            saveDailyNpc(date, pending);

            const result = await requestCoach({
              userId: profile.name,
              domains: useDomains,
              facts: coachContext.facts,
              episodes: coachContext.episodes,
              seed: dailySeed(date, useDomains),
              now: coachContext.now,
            });
            // 结算后已发起新的复盘（seq 更大）→ 开局这份作废，避免覆盖最新统计。
            if (cancelled || seq !== npcSeqRef.current) return;
            setNpc(result.decision);
            saveDailyNpc(date, result.decision);
          } catch (error) {
            // NPC 是增强，不是主链路 —— 失败静默降级即可
            console.warn("[daily] NPC 点评不可用：", error);
          }
        };

        if (locked) {
          const pool = await loadQuestionPool(useDomains);
          const byId = new Map<string, Question>();
          for (const list of Object.values(pool)) {
            for (const q of list ?? []) byId.set(q.id, q);
          }
          const qs = locked.questionIds.map((id) => byId.get(id)).filter(Boolean) as Question[];
          if (qs.length > 0) {
            setQuestions(qs);
            // 点评随会话落盘：锁定会话再次进入时先读回，缺失（旧会话）再补请求。
            setNpc(locked.npc ?? null);
            setPracticeSkipped(locked.practiceSkipped ?? false);
            if (locked.done) {
              setFinished(true);
              setScore(locked.score ?? 0);
              setStars(locked.stars ?? 0);
              setMaxCombo(locked.maxCombo ?? 0);
              setRecords([]);
              setCorrectCount(locked.correct ?? 0);
              setPracticeReason(locked.practiceReason ?? null);
              setPracticeCorrect(locked.practiceCorrect ?? null);
              // 已完成的一局：直接给出与**同口径**影子的对比结论
              setVerdict(
                compareWithGhost(locked.score ?? 0, getComparableGhost(ghostKey(useDomains)))
              );
            } else {
              setIndex(0);
            }
            setLoading(false);
            // 缺失（旧会话）或落盘的是 `pending`（上次模型还没回来）→ 重新请求：
            // 界面先显示已落盘的模板 + 生成中状态，回来后再替换。
            if (!locked.npc || resolveCommentaryStatus(locked.npc) === "pending") {
              void requestNpc(makeContext(pool));
            }
            return;
          }
        }

        // 抽题并锁定
        const pool = await loadQuestionPool(useDomains);

        // ---- 4+1 分轨：前 4 题全网同题，第 5 题由 NPC 个人加练 ----
        //
        // 前 4 题严格走 `buildDailySet`（不注入任何用户事实）—— 同日期 + 同领域集合
        // 全网逐题一致（AGENTS.md §2.1）。NPC 只选第 5 题：
        // 最弱域 → 最生疏知识点 → 排除前 4 题已出现的题。
        //
        // 首次使用（没有任何答题事实）或上下文构造失败 → 不选加练题，
        // 第 5 题回落到公共题的原第 5 题，行为与改动前一致。
        const npcContext = makeContext(pool);

        const publicPicks = buildDailySet({
          dateKey: date,
          domains: useDomains,
          pool,
          // 同一领域集合下整池轮转，避免“2 天撞同一题”
          schedule: "cycle",
        });
        if (publicPicks.length === 0) {
          setError("所选领域的题库还在准备中，请稍后再试或换个领域");
          setLoading(false);
          return;
        }

        const publicQuestions = publicPicks.slice(0, PUBLIC_DAILY_COUNT).map((p) => p.question);
        const fallbackFifth = publicPicks[PUBLIC_DAILY_COUNT]?.question;
        const practice =
          npcContext && npcContext.facts.touchedDomains > 0
            ? pickPracticeQuestion({
                context: npcContext,
                excludeIds: new Set(publicQuestions.map((q) => q.id)),
              })
            : undefined;
        const practiceQuestion = practice?.question ?? fallbackFifth;
        const qs = practiceQuestion ? [...publicQuestions, practiceQuestion] : publicQuestions;
        const reason =
          practice?.reason ??
          (practiceQuestion ? "先在公共题里热身，以后我会按你的薄弱域出加练题" : null);

        setQuestions(qs);
        setPracticeReason(reason);
        setPracticeCorrect(null);
        const session: DailySession = {
          date,
          domains: useDomains,
          questionIds: qs.map((q) => q.id),
          done: false,
          mode: dailyMode,
          scoringVersion: SCORING_VERSION,
          ...(reason ? { practiceReason: reason } : {}),
          ...(practiceQuestion
            ? {
                practiceFunnel: {
                  shown: true,
                  answered: false,
                  correct: false,
                  skipped: false,
                  resultSeen: false,
                } satisfies PracticeFunnel,
              }
            : {}),
        };
        saveDailySession(session);
        setLoading(false);

        // ---- 老师 NPC：拿到点评（模型不可用时由服务端降级为模板）----
        //
        // 选题已经用上面这份上下文算好；这里只补「说什么」。
        // 点评结果会写回当日会话，刷新后仍能显示。
        void requestNpc(npcContext);
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
      // 只认「答案本体」：JSX 里把 submit 直接当 onClick 用会把 MouseEvent 传进来，
      // 那时必须回落到 picked，而不是拿事件对象去比对（会静默答不上）。
      const value = typeof explicit === "string" || Array.isArray(explicit) ? explicit : picked;
      const answerList = Array.isArray(value) ? value : [value];
      if (answerList.length === 0 || answerList.every((a) => !a)) return;

      const correct = isCorrect(current.type, current.answer, value);
      // 4+1 分轨：第 5 题（index = PUBLIC_DAILY_COUNT）是个人加练，不计分。
      const isPractice = index === PUBLIC_DAILY_COUNT;
      // 跨域连击：只在跨域时增长，同域不增长也不清零；答错清零。
      // 加练题不参与连击 —— 它不计分，也不该影响排行榜口径。
      const nextComboValue = isPractice
        ? combo
        : correct
          ? nextCombo(combo, true, lastWinDomainRef.current, current.domain)
          : 0;
      const points =
        correct && !isPractice ? roundPoints(current.difficulty, elapsed, limit, combo) : 0;

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
        practice: isPractice,
      };

      if (correct && !isPractice) lastWinDomainRef.current = current.domain;

      setRecords((prev) => [...prev, record]);
      setScore((s) => s + points);
      if (correct && !isPractice) setCorrectCount((n) => n + 1);
      setCombo(nextComboValue);
      if (!isPractice) setMaxCombo((m) => Math.max(m, nextComboValue));
      if (isPractice) setPracticeCorrect(correct);
      setSubmitted(true);

      recordAttempt({
        questionId: current.id,
        domain: current.domain,
        topic: current.topic,
        correct,
        // 第 5 题加练只写熟练度，不写错题本（PRD 口径）。
        ...(isPractice ? { wrong: false } : {}),
      });

      // ---- 加练题埋点：已作答 / 作答正确（只写当日会话，不影响分数与排名） ----
      if (isPractice) updatePracticeFunnel(date, { answered: true, correct });

      // ---- 老师 NPC：记录本次作答（跨会话记忆的来源） ----
      //
      // 与 `recordAttempt` **并行**：既有引擎负责熟练度与错题本，
      // NPC 只多存一份**单题事件流**（情景记忆的原料）。
      // 失败静默 —— NPC 是增强，记忆写不进去不该影响答题。
      try {
        const wrongEntries = getWrongEntries();
        const npcContext = buildCoachContext({
          userId: getProfile().name,
          domains: domains.length > 0 ? domains : [current.domain],
          pool: {},
          mastery: getMastery(),
          wrongEntries: wrongEntries.map((e) => ({
            domain: e.domain,
            wrongCount: e.wrongCount,
          })),
          history: getHistory().map((h) => ({
            domains: h.domains,
            correct: h.correct,
            total: h.total,
          })),
          seed: dailySeed(date, domains.length > 0 ? domains : [current.domain]),
          now: Date.now(),
        });
        void recordCoachEvent({
          userId: getProfile().name,
          facts: npcContext.facts,
          // 连击必须传**本局真实值**：错题本 streak 毕业阈值是 2，最大只有 1，
          // 喂 0 会让 ruleImportance 的连击降权永远不生效。
          event: buildAnswerEvent({
            questionId: current.id,
            domain: current.domain,
            topic: current.topic,
            difficulty: current.difficulty,
            correct,
            combo: nextComboValue,
            // 标注来源：公共题 / 加练题，便于以后按曝光统计覆盖。
            source: isPractice ? "practice" : "public",
            at: Date.now(),
          }),
        });
      } catch (error) {
        console.warn("[daily] NPC 记忆写入失败：", error);
      }
    },
    [current, picked, submitted, combo, index, date]
  );

  /**
   * 结算本局：4+1 分轨只按**公共题**（前 4 题）计分、计连击、计答对数。
   *
   * 第 5 题即使答对也不进 score / maxCombo / history，只写熟练度
   * （见 `recordAttempt` 的 `wrong: false`）。
   *
   * `skippedPractice`：用户主动跳过第 5 题时为 true —— 不计作答、不惩罚，
   * 漏斗只记 `skipped`（与 `answered` 互斥）。
   */
  const finish = useCallback(
    (skippedPractice: boolean) => {
      const settled = settlePublicAnswers(records);
      const publicQuestions = questions.slice(0, PUBLIC_DAILY_COUNT);
      const max = maxScore(publicQuestions.map((q) => q.difficulty));
      const rating = starRating(settled.score, max);
      const finalScore = settled.score;
      const correctCount = settled.correct;
      const publicMaxCombo = settled.maxCombo;
      const practiceRecord = records.find((r) => r.practice);
      // 加练题埋点：展示 / 作答 / 正确 / 跳过；结算页曝光由页面调用
      // markPracticeResultSeen 补写。跳过绝不能记成 answered。
      const practiceFunnel: PracticeFunnel = {
        shown: questions.length > PUBLIC_DAILY_COUNT,
        answered: practiceRecord !== undefined,
        correct: practiceRecord?.correct ?? false,
        skipped: skippedPractice && practiceRecord === undefined,
        resultSeen: false,
      };
      setStars(rating);
      setFinished(true);

      // ---- 影子对手：用本局成绩刷新"过去的自己" ----
      // 对比的是**本局开始前**的影子：先算结论，再更新影子，否则等于自己跟自己比。
      // 只取同口径影子：旧口径（5 题）的最高分不能当 4 题成绩的基准。
      const key = ghostKey(domains);
      const prevGhost = getComparableGhost(key);
      const totalElapsed = records
        .filter((r) => !r.practice)
        .reduce((sum, r) => sum + r.elapsed, 0);
      saveGhost(
        updateGhost(prevGhost, {
          key,
          score: finalScore,
          correct: correctCount,
          date,
          elapsed: totalElapsed,
          scoringVersion: SCORING_VERSION,
        })
      );
      setVerdict(compareWithGhost(finalScore, prevGhost));

      // ---- 生涯累计（段位用，不受 30 场历史窗口影响） ----
      // 按口径分桶：旧数据留在 v1，不参与 v2 段位。
      bumpLifetimeStats(
        { correct: correctCount, stars: rating, maxCombo: publicMaxCombo },
        SCORING_VERSION
      );

      saveDailySession({
        date,
        domains,
        questionIds: questions.map((q) => q.id),
        done: true,
        score: finalScore,
        correct: correctCount,
        stars: rating,
        maxCombo: publicMaxCombo,
        mode,
        scoringVersion: SCORING_VERSION,
        practiceFunnel,
        ...(practiceReason ? { practiceReason } : {}),
        ...(practiceRecord ? { practiceCorrect: practiceRecord.correct } : {}),
        ...(skippedPractice && practiceRecord === undefined ? { practiceSkipped: true } : {}),
      });
      // 开局点评的事实是「一题未答」，不能拿来冒充结算后的统计：
      // 先清掉会话里的旧点评，再按最新事实重新生成并写回（刷新读到的是最后一份）。
      setNpc(null);
      void refreshNpc();
      bumpStreak(date);
      pushHistory({
        date,
        domains,
        score: finalScore,
        correct: correctCount,
        // 榜单口径：只算公共题，题数与得分同源。
        total: publicQuestions.length,
        stars: rating,
        maxCombo: publicMaxCombo,
        mode: "daily",
        // 新记录标 v2；旧记录没有该字段，按 v1 处理，不重算。
        scoringVersion: SCORING_VERSION,
      });
    },
    [records, questions, date, domains, mode, practiceReason, refreshNpc]
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
    finish(false);
  }, [submitted, index, questions.length, finish]);

  /**
   * 跳过第 5 题加练：不惩罚、不强制答完，直接结算。
   *
   * 只允许在「当前正是加练题且尚未提交」时调用 —— 其余时刻一律无操作，
   * 避免把公共题也跳过去（那会破坏 4 题计分口径）。
   */
  const skipPractice = useCallback(() => {
    if (finished || submitted) return;
    if (index !== PUBLIC_DAILY_COUNT || !questions[index]) return;
    updatePracticeFunnel(date, { skipped: true, answered: false, correct: false });
    setPracticeSkipped(true);
    setPracticeCorrect(null);
    finish(true);
  }, [finished, submitted, index, questions, date, finish]);

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
    setPracticeCorrect(null);
    setPracticeSkipped(false);
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
    npc,
    practiceReason,
    practiceCorrect,
    practiceSkipped,
    start: reset,
    toggleOption,
    submit,
    next,
    skipPractice,
    reset,
  };
}

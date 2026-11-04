/**
 * 计分、连击与星级 —— 每日挑战与对战 duel 共用同一套公式。
 *
 * 公式（docs/GAME-RULES.md §3.1）：
 *   base   = { 难度1: 10, 难度2: 20, 难度3: 30 }
 *   speed  = clamp(1 - elapsed / limit, 0, 1) * 0.5 + 0.5        // 0.5 ~ 1.0
 *   blitz  = elapsed <= limit / 3 ? 1.2 : 1.0
 *   points = round(base * speed * blitz * comboMultiplier)
 *
 * 跨域连击（docs/GAME-RULES.md §3.4）：只在**跨域抢先答对**时增长；同域抢先答对保持不变（不奖不罚）；
 * 惩罚只针对自己的失误 —— **自己**答错或**自己**超时未答才归零。
 * 「被对手抢先」不是失误，连击保持不变（裁定与理由见 `lib/store/room.ts` 文件头）。
 */

import type { Difficulty, DomainId, ScoringVersion } from "@/types";

export const BASE_POINTS: Record<Difficulty, number> = { 1: 10, 2: 20, 3: 30 };

/** 每题的作答限时（毫秒），随难度递减。 */
export const DIFFICULTY_LIMIT_MS: Record<Difficulty, number> = {
  1: 30_000,
  2: 25_000,
  3: 20_000,
};

/** 速度系数：越快越高，区间 [0.5, 1.0]。 */
export function speedFactor(elapsed: number, limit: number): number {
  if (limit <= 0) return 0.5;
  const ratio = Math.max(0, Math.min(1, elapsed / limit));
  return (1 - ratio) * 0.5 + 0.5;
}

/** 秒答加成：前 1/3 时间内答对额外 ×1.2。 */
export function blitzFactor(elapsed: number, limit: number): number {
  return elapsed <= limit / 3 ? 1.2 : 1.0;
}

/**
 * 跨域连击倍率曲线。
 * 0-1 → ×1.0；2-3 → ×1.05；4-5 → ×1.1；6+ → ×1.2（封顶，避免滚雪球）。
 */
export function comboMultiplier(combo: number): number {
  if (combo >= 6) return 1.2;
  if (combo >= 4) return 1.1;
  if (combo >= 2) return 1.05;
  return 1.0;
}

/** 单题得分。 */
export function roundPoints(
  difficulty: Difficulty,
  elapsed: number,
  limit: number,
  combo: number
): number {
  const base = BASE_POINTS[difficulty];
  return Math.round(
    base * speedFactor(elapsed, limit) * blitzFactor(elapsed, limit) * comboMultiplier(combo)
  );
}

/** 一局的最大可能总分（用于星级映射）。 */
export function maxScore(difficulties: readonly Difficulty[]): number {
  // 理论满分：速度系数取 1.0、秒答加成 1.2、连击封顶 1.2
  return difficulties.reduce((sum, d) => sum + BASE_POINTS[d] * 1.0 * 1.2 * 1.2, 0);
}

/** 星级映射：≥60% 满分 → 3 星；≥35% → 2 星；其余 1 星。 */
export function starRating(score: number, max: number): number {
  if (max <= 0) return 1;
  const ratio = score / max;
  if (ratio >= 0.6) return 3;
  if (ratio >= 0.35) return 2;
  return 1;
}

/**
 * 连击推进。
 *
 * @param combo        当前连击数
 * @param won          本回合是否**抢先答对**
 * @param prevDomain   本玩家上一次抢先答对的领域（null 表示还没有）
 * @param currentDomain 本回合的领域
 */
export function nextCombo(
  combo: number,
  won: boolean,
  prevDomain: DomainId | null,
  currentDomain: DomainId
): number {
  if (!won) return 0;
  if (prevDomain !== null && prevDomain === currentDomain) return combo; // 同域：不增长也不清零
  return combo + 1;
}

/** 对战比分判定：总分 → 抢先答对数 → 平局。 */
export function decideWinner(
  scores: Record<string, number>,
  firstCorrect: Record<string, number>
): string | null {
  const ids = Object.keys(scores);
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  const sorted = ids.slice().sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return (firstCorrect[b] ?? 0) - (firstCorrect[a] ?? 0);
  });
  if (
    scores[sorted[0]] === scores[sorted[1]] &&
    (firstCorrect[sorted[0]] ?? 0) === (firstCorrect[sorted[1]] ?? 0)
  ) {
    return null; // 平局
  }
  return sorted[0];
}

/**
 * 4+1 分轨：每日挑战前 **4** 题全网同题并计分，第 5 题是个人的加练题。
 *
 * 题数常量放在引擎里，客户端、榜单与测试共用同一口径；
 * 第 5 题的作答仍写熟练度，但不进入这里的结算。
 */
export const PUBLIC_DAILY_COUNT = 4;

export interface ScoredAnswer {
  readonly correct: boolean;
  readonly points: number;
  readonly combo: number;
  /** 是否为第 5 题（个人加练）。 */
  readonly practice?: boolean;
}

/**
 * 只按**公共题**结算：得分、答对题数、最高连击。
 *
 * 抽成纯函数，客户端结算与单测共用同一份代码 —— 防止"界面上少了 1 题、
 * 榜单却仍按 5 题算"这类口径漂移。
 */
export function settlePublicAnswers(answers: readonly ScoredAnswer[]): {
  score: number;
  correct: number;
  maxCombo: number;
} {
  const publicAnswers = answers.filter((a) => !a.practice);
  return {
    score: publicAnswers.reduce((sum, a) => sum + a.points, 0),
    correct: publicAnswers.filter((a) => a.correct).length,
    maxCombo: publicAnswers.reduce((max, a) => Math.max(max, a.combo), 0),
  };
}

/**
 * 当前新记录使用的计分口径：v2 = 4+1 分轨（前 4 题计分）。
 *
 * 历史记录不重算：v1（旧版 5 题计分）与 v2 各自独立统计，
 * 跨版本不参与排名类计算（生涯累计 / 段位 / 影子对比）。
 */
export const SCORING_VERSION: ScoringVersion = 2;

/**
 * 读取记录的口径版本：**缺失即 v1**。
 *
 * 这是兼容旧数据的唯一判据 —— 不迁移、不补字段、不重算分数。
 */
export function scoringVersionOf(entry: {
  readonly scoringVersion?: ScoringVersion;
}): ScoringVersion {
  return entry.scoringVersion ?? 1;
}

/** 界面上给用户看的口径标签。 */
export function scoringVersionLabel(version: ScoringVersion): string {
  return version === 1 ? "旧口径（5 题）" : "4 题计分";
}

// ---------------------------------------------------------------- 生涯累计（按口径分桶）

/** 单一口径下的生涯累计。 */
export interface LifetimeStats {
  /** 生涯答对题数。 */
  totalCorrect: number;
  /** 生涯完成局数。 */
  totalPlayed: number;
  /** 生涯累计星级。 */
  totalStars: number;
  /** 生涯最高连击。 */
  bestCombo: number;
}

/** 生涯累计存储：每个口径一个独立桶，互不混算。 */
export interface LifetimeStore {
  v1?: LifetimeStats;
  v2?: LifetimeStats;
}

export const EMPTY_LIFETIME: LifetimeStats = {
  totalCorrect: 0,
  totalPlayed: 0,
  totalStars: 0,
  bestCombo: 0,
};

function fillLifetime(raw: unknown): LifetimeStats {
  const value = (raw ?? {}) as Partial<LifetimeStats>;
  return {
    totalCorrect: value.totalCorrect ?? 0,
    totalPlayed: value.totalPlayed ?? 0,
    totalStars: value.totalStars ?? 0,
    bestCombo: value.bestCombo ?? 0,
  };
}

/**
 * 归一化生涯累计存储。
 *
 * 旧格式是**扁平 bucket**（没有 v1/v2 包装），按 v1 处理 ——
 * 旧数据就是 5 题口径，不重算、不迁移成 v2。
 */
export function normalizeLifetimeStore(raw: unknown): LifetimeStore {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  if ("v1" in obj || "v2" in obj) {
    return {
      ...(obj.v1 !== undefined ? { v1: fillLifetime(obj.v1) } : {}),
      ...(obj.v2 !== undefined ? { v2: fillLifetime(obj.v2) } : {}),
    };
  }
  if ("totalPlayed" in obj || "totalCorrect" in obj) {
    return { v1: fillLifetime(obj) };
  }
  return {};
}

/** 取某个口径的生涯累计（缺省桶视为全 0）。 */
export function lifetimeForVersion(
  store: LifetimeStore,
  version: ScoringVersion = SCORING_VERSION
): LifetimeStats {
  return (version === 1 ? store.v1 : store.v2) ?? EMPTY_LIFETIME;
}

/** 累加一局到某个口径的桶（纯函数）。 */
export function addLifetime(
  prev: LifetimeStats,
  delta: { correct: number; stars: number; maxCombo: number }
): LifetimeStats {
  return {
    totalCorrect: prev.totalCorrect + Math.max(0, delta.correct),
    totalPlayed: prev.totalPlayed + 1,
    totalStars: prev.totalStars + Math.max(0, delta.stars),
    bestCombo: Math.max(prev.bestCombo, delta.maxCombo),
  };
}

/**
 * 计分、连击与星级 —— 每日挑战与对战 duel 共用同一套公式。
 *
 * 公式（§4.6）：
 *   base   = { 难度1: 10, 难度2: 20, 难度3: 30 }
 *   speed  = clamp(1 - elapsed / limit, 0, 1) * 0.5 + 0.5        // 0.5 ~ 1.0
 *   blitz  = elapsed <= limit / 3 ? 1.2 : 1.0
 *   points = round(base * speed * blitz * comboMultiplier)
 *
 * 跨域连击（§4.5）：只在**跨域抢先答对**时增长；同域答对保持不变（不惩罚）；
 * 答错 / 被抢 / 超时归零。对手抢先答对不影响本玩家连击（不奖不罚）。
 */

import type { Difficulty, DomainId } from "@/types";

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

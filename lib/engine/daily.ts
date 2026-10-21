/**
 * 每日挑战抽题引擎 —— **纯函数，无副作用，无 IO**。
 *
 * 核心性质：题集 = f(日期, 领域集合, 题数)，同一输入永远得到同一输出。
 * 客户端与服务端跑同一份代码，因此：
 * - 同一天 + 同一组领域 → **全网同一份题**（天然可比、可分享）；
 * - 每日挑战**完全不需要服务端状态**（这是双轨部署架构的支点）。
 *
 * 算法（docs/GAME-RULES.md §2.1）：
 * 1. `daySeed = hashSeed("daily:" + dateKey + ":" + canonicalDomains(domains).join(","))`
 * 2. `mulberry32(daySeed)` 初始化 PRNG
 * 3. 领域轮转顺序 = 对 domains 做 Fisher-Yates 洗牌
 * 4. 第 i 题取自 `order[i % order.length]`
 * 5. 域内按 PRNG 取未出过的题；优先匹配难度曲线，不足则放宽
 * 6. 最后一题为「彩蛋题」：取自与上一题**不同**的领域（仍在所选领域内），制造换域节奏
 *
 * ## 为什么领域要先规范化排序
 *
 * 「同一组领域」指的是**集合**，不是列表。用户 A 先点游戏再点动漫，
 * 用户 B 先点动漫再点游戏 —— 选的是同一组领域，当天的题必须完全相同，
 * 否则「全网同题」就是空话，跨好友比较分数也失去意义。
 * 因此种子与轮转顺序都基于 `canonicalDomains()`（排序后的副本），
 * **与输入顺序无关**。
 */

import type { Difficulty, DomainId, Question } from "@/types";
import { hashSeed, mulberry32, pickOne, shuffled } from "./prng";

export const DEFAULT_DAILY_COUNT = 5;

/** 难度曲线（5 题时为 1,1,2,2,3）。 */
const DIFFICULTY_CURVE: readonly Difficulty[] = [1, 1, 2, 2, 3];

/** 一道已选定的题目。 */
export interface DailyPick {
  question: Question;
  /** 是否为末位「彩蛋题」。 */
  isEgg: boolean;
  index: number;
}

/**
 * 领域集合的**规范序** —— 排序后的副本。
 *
 * 「同一组领域」是集合概念：用户按不同顺序点选，选中的其实是同一组领域。
 * 种子与轮转顺序都基于它，才能保证「全网同题」与输入顺序无关。
 */
export function canonicalDomains(domains: readonly DomainId[]): DomainId[] {
  return [...domains].sort();
}

/** 每日挑战的种子口径 —— 客户端与服务端必须完全一致。 */
export function dailySeed(dateKey: string, domains: readonly DomainId[]): number {
  return hashSeed("daily:" + dateKey + ":" + canonicalDomains(domains).join(","));
}

/** 按题数取难度曲线。 */
export function difficultyCurve(count: number): Difficulty[] {
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => {
    const idx = Math.min(
      DIFFICULTY_CURVE.length - 1,
      Math.floor((i * DIFFICULTY_CURVE.length) / n)
    );
    return DIFFICULTY_CURVE[idx];
  });
}

/** 「随缘开局」：按日期种子从候选领域中确定性地选 count 个。全网同一天结果一致。 */
export function pickRandomDomains(
  dateKey: string,
  candidates: readonly DomainId[],
  count = 3
): DomainId[] {
  return pickDomainsBySeed(hashSeed("random-domains:" + dateKey), candidates, count);
}

/** 按显式种子选领域（duel 房主未选领域时使用，保证双方一致）。 */
export function pickDomainsBySeed(
  seed: number,
  candidates: readonly DomainId[],
  count = 3
): DomainId[] {
  if (candidates.length === 0) return [];
  const rng = mulberry32(seed);
  const order = shuffled(candidates, rng);
  return order.slice(0, Math.min(count, order.length)).sort();
}

export interface BuildDailyParams {
  /** `YYYY-MM-DD`（Asia/Shanghai）。 */
  dateKey: string;
  /** 玩家选定的领域（1-3 个）。 */
  domains: readonly DomainId[];
  /** 题数，默认 5。 */
  count?: number;
  /** 候选题池：领域 → 该领域的全部题目。 */
  pool: Partial<Record<DomainId, Question[]>>;
  /**
   * 显式种子。传入时忽略 `dateKey` —— 对战 duel 用房间 seed，
   * 保证双方从同一 seed 派生同一份题序。
   */
  seed?: number;
}

/**
 * 构建每日题集。
 *
 * 退化行为（保证「绝不出现空题面」）：
 * - 某域没有匹配难度的题 → 放宽到该域任意难度；
 * - 某域已出完 → 允许重复（题量不足时的兜底）；
 * - 某域完全为空 → 跳过该域，用其他域补位；
 * - 全部为空 → 返回空数组（由调用方给出「该领域题库准备中」的提示）。
 */
export function buildDailySet(params: BuildDailyParams): DailyPick[] {
  const { dateKey, pool } = params;
  const count = Math.max(1, params.count ?? DEFAULT_DAILY_COUNT);

  // 先规范序：领域是**集合**，与用户点选顺序无关
  const domains = canonicalDomains(params.domains);
  const usable = domains.filter((d) => (pool[d]?.length ?? 0) > 0);
  if (usable.length === 0) return [];

  const seed = params.seed ?? dailySeed(dateKey, domains);
  const rng = mulberry32(seed);
  const order = shuffled(usable, rng);
  const curve = difficultyCurve(count);

  const used = new Set<string>();
  const picks: DailyPick[] = [];

  for (let i = 0; i < count; i++) {
    const targetDifficulty = curve[i];
    const isEgg = i === count - 1;
    // 彩蛋题：尽量取与上一题不同的领域
    const prevDomain = picks.length > 0 ? picks[picks.length - 1].question.domain : null;

    let domain = order[i % order.length];
    if (isEgg && prevDomain !== null && domain === prevDomain) {
      const alt = order.find((d) => d !== prevDomain && (pool[d]?.length ?? 0) > 0);
      if (alt) domain = alt;
    }

    const q = pickQuestion(pool[domain], targetDifficulty, used, rng);
    if (!q) {
      // 该域取不到题 → 换域重试一次
      const fallbackDomain = order.find((d) => d !== domain && (pool[d]?.length ?? 0) > 0);
      const alt = fallbackDomain
        ? pickQuestion(pool[fallbackDomain], targetDifficulty, used, rng)
        : undefined;
      if (!alt) continue;
      picks.push({ question: alt, isEgg, index: picks.length });
      continue;
    }
    picks.push({ question: q, isEgg, index: picks.length });
  }

  return picks;
}

/** 域内取题：优先匹配难度 → 放宽到任意难度 → 允许重复。 */
function pickQuestion(
  candidates: readonly Question[] | undefined,
  difficulty: Difficulty,
  used: Set<string>,
  rng: () => number
): Question | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  const fresh = candidates.filter((q) => !used.has(q.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  const exact = pool.filter((q) => q.difficulty === difficulty);
  const target = exact.length > 0 ? exact : pool;
  const q = pickOne(target, rng);
  if (q) used.add(q.id);
  return q;
}

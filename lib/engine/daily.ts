/**
 * 每日挑战抽题引擎 —— **纯函数，无副作用，无 IO**。
 *
 * 核心性质：题集 = f(日期, 领域集合, 题数)，同一输入永远得到同一输出。
 * 客户端与服务端跑同一份代码，因此：
 * - 同一天 + 同一组领域 → **全网同一份题**（天然可比、可分享）；
 * - 每日挑战**完全不需要服务端状态**（这是双轨部署架构的支点）。
 *
 * 两种调度：
 *
 * - `legacy`（默认）：沿用原算法，每天独立随机抽题；重复来得快，但完全保持旧行为。
 *   **duel 必须留在这里**：房间只有房间 seed + 空 `dateKey`，没有「按日期推进游标」的语义，
 *   5 回合又由 `TOTAL_ROUNDS` 截断；换成 cycle 等于把日历游标带进对战。
 * - `cycle`：每日挑战 / 同题 PK 使用。同一领域集合下，把整池题按难度曲线排成确定性序列，
 *   按日期推进游标；一个周期内每题只出现一次，周期 = `floor(题池总数 / 题数)` 天。
 *   3 个领域、题池约 150 题时约 30 天；2 域 20–24 天；单域 50 题时上限 10 天（内容量的硬上限）。
 *   **先保不重复、后保难度曲线**：某一档用尽后按既有退化规则放宽到任意难度。
 *
 * 算法（docs/GAME-RULES.md §2.1）：
 * 1. 领域先走 `canonicalDomains()`，保证「同一组领域」是集合语义
 * 2. 抽题种子：`legacy` 用 `dailySeed(dateKey, domains)`；`cycle` 用领域集合的稳定种子，
 *    这样每天推进的是同一份题序，而不是每天重新洗牌
 * 3. 难度曲线按题数取 1,1,2,2,3（题数更多时重复该曲线）
 * 4. `cycle` 把整池题按曲线分槽，按日期块推进；槽内优先取目标难度，取不到才放宽
 * 5. 最后一题为「彩蛋题」：优先取与上一题**不同**的领域
 * 6. 选项顺序用「局种子 + question.id」派生独立 PRNG 打乱，不消耗抽题随机流
 *
 * ## 为什么领域要先规范化排序
 *
 * 「同一组领域」指的是**集合**，不是列表。用户 A 先点游戏再点动漫，
 * 用户 B 先点动漫再点游戏 —— 选的是同一组领域，当天的题必须完全相同，
 * 否则「全网同题」就是空话，跨好友比较分数也失去意义。
 * 因此种子与轮转顺序都基于 `canonicalDomains()`（排序后的副本），
 * **与输入顺序无关**。
 */

import type { Difficulty, DomainId, Question, QuestionType } from "@/types";
import { hashSeed, mulberry32, pickOne, shuffled } from "./prng";
import { shuffleOptions } from "./options";
import { daysBetween } from "./date";

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
  /**
   * 只允许这些题型；缺省不过滤。
   * duel 传 `["single", "judge"]`，避免多选拖慢抢答节奏。
   */
  allowedTypes?: readonly QuestionType[];
  /**
   * 抽题调度：
   * - `legacy`（默认）：保留旧随机抽题。**duel 必须留在这里** —— 它用房间 seed +
   *   空 `dateKey`，没有「按日期推进游标」的语义，且 5 回合由 `TOTAL_ROUNDS` 截断；
   *   换成 cycle 会让对战抽题带上日历游标，破坏房间内可复现性。
   * - `cycle`：每日挑战 / 同题 PK 使用。按日期块推进整池轮转，同一领域集合下
   *   整池过一遍才重复；先保不重复，难度档用尽后再按既有规则放宽。
   */
  schedule?: "legacy" | "cycle";
}

/** 按题型过滤题池；不修改原池。 */
function filterPoolByTypes(
  pool: Partial<Record<DomainId, Question[]>>,
  allowedTypes: readonly QuestionType[]
): Partial<Record<DomainId, Question[]>> {
  const out: Partial<Record<DomainId, Question[]>> = {};
  for (const domain of Object.keys(pool) as DomainId[]) {
    out[domain] = (pool[domain] ?? []).filter((q) => allowedTypes.includes(q.type));
  }
  return out;
}

/**
 * `cycle` 调度的稳定种子：只随领域集合变化，**不随日期变化**。
 *
 * 如果这里混入日期，每天都会重新洗牌，块与块之间又会重叠，
 * “整池轮转”就退化成原来的随机抽题。
 */
function cycleSeed(domains: readonly DomainId[]): number {
  return hashSeed("daily-cycle:" + domains.join(","));
}

/** 从 `first` 开始按原数组顺序轮转，用于把当日首选域排到最前。 */
function rotateFrom<T>(arr: readonly T[], first: T): T[] {
  const idx = arr.indexOf(first);
  if (idx <= 0) return [...arr];
  return [...arr.slice(idx), ...arr.slice(0, idx)];
}

/**
 * 按难度曲线把整池题排成一个确定性序列。
 *
 * 取舍：
 * - **先保不重复，再保难度曲线**。某一档难度用尽后放宽到任意难度（沿用旧退化规则），
 *   因为难度 1 的题量才是 30 天窗口的实际上限；
 * - 领域按 `blockIndex + slot` 轮转，让每个域在多个块之间均衡消耗；
 * - 末位彩蛋题优先避开上一题的领域，只有单域或其它域无题时才回退。
 */
function buildCycleSequence(
  domains: readonly DomainId[],
  pool: Partial<Record<DomainId, Question[]>>,
  count: number,
  seed: number
): Question[] {
  const perDomain = new Map<DomainId, Question[]>();
  for (const domain of domains) {
    perDomain.set(
      domain,
      shuffled(pool[domain] ?? [], mulberry32(hashSeed("cycle:" + seed + ":" + domain)))
    );
  }

  const total = domains.reduce((sum, domain) => sum + (perDomain.get(domain)?.length ?? 0), 0);
  const cycleDays = Math.max(1, Math.floor(total / count));
  const curve = difficultyCurve(count);
  const used = new Set<string>();
  const sequence: Question[] = [];
  let prevDomain: DomainId | null = null;

  for (let i = 0; i < cycleDays * count; i++) {
    const blockIndex = Math.floor(i / count);
    const slot = i % count;
    const preferred = domains[(blockIndex + slot) % domains.length];
    const avoid = slot === count - 1 ? prevDomain : null;
    const q = takeCycleQuestion(domains, perDomain, used, curve[slot], preferred, avoid);
    if (!q) break;
    sequence.push(q);
    used.add(q.id);
    prevDomain = q.domain;
  }

  return sequence;
}

/** 序列取题：目标难度 + 避开彩蛋重复域优先，逐级放宽。 */
function takeCycleQuestion(
  domains: readonly DomainId[],
  perDomain: Map<DomainId, Question[]>,
  used: Set<string>,
  target: Difficulty,
  preferred: DomainId,
  avoid: DomainId | null
): Question | undefined {
  const ordered = rotateFrom(domains, preferred);
  const canAvoid = avoid !== null && domains.length > 1;

  // 1. 目标难度，且不是彩蛋题要避开的领域
  for (const domain of ordered) {
    if (canAvoid && domain === avoid) continue;
    const q = perDomain
      .get(domain)
      ?.find((item) => !used.has(item.id) && item.difficulty === target);
    if (q) return q;
  }

  // 2. 任意难度，仍避开彩蛋重复域（与旧算法的换域优先一致）
  for (const domain of ordered) {
    if (canAvoid && domain === avoid) continue;
    const q = perDomain.get(domain)?.find((item) => !used.has(item.id));
    if (q) return q;
  }

  // 3. 其它域都没题了，允许回到目标难度（单域场景）
  for (const domain of ordered) {
    const q = perDomain
      .get(domain)
      ?.find((item) => !used.has(item.id) && item.difficulty === target);
    if (q) return q;
  }

  // 4. 最后兜底：任意未出过的题
  for (const domain of ordered) {
    const q = perDomain.get(domain)?.find((item) => !used.has(item.id));
    if (q) return q;
  }

  return undefined;
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
  const { dateKey } = params;
  const pool = params.allowedTypes
    ? filterPoolByTypes(params.pool, params.allowedTypes)
    : params.pool;
  const count = Math.max(1, params.count ?? DEFAULT_DAILY_COUNT);

  // 先规范序：领域是**集合**，与用户点选顺序无关
  const domains = canonicalDomains(params.domains);
  const usable = domains.filter((d) => (pool[d]?.length ?? 0) > 0);
  if (usable.length === 0) return [];

  const seed = params.seed ?? dailySeed(dateKey, domains);

  if (params.schedule === "cycle") {
    // daily 用“领域集合”稳定种子，跨天推进同一份题序；
    // PK 传入显式 seed（含日期 + 房间码），因此同码同日同题、异码异题。
    const sequence = buildCycleSequence(usable, pool, count, params.seed ?? cycleSeed(domains));
    if (sequence.length === 0) return [];

    // 按日期块推进，保证每天的 5 题仍对齐难度曲线；周期结束后才回到第 0 块。
    // 以产品上线档期为锚点，避免新算法上线首日落在周期末尾、难度曲线被提前放宽。
    const cycleDays = Math.max(1, Math.floor(sequence.length / count));
    const dayIndex = daysBetween(dateKey, "2026-01-01");
    const dayOffset = ((dayIndex % cycleDays) + cycleDays) % cycleDays;
    const start = dayOffset * count;

    const picks: DailyPick[] = [];
    for (let i = 0; i < count; i++) {
      const q = sequence[(start + i) % sequence.length];
      if (!q) continue;
      picks.push({ question: q, isEgg: i === count - 1, index: picks.length });
    }

    return picks.map((pick) => ({
      ...pick,
      question: shuffleOptions(pick.question, seed),
    }));
  }

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

  // 选项顺序也参与确定性：同一题 + 同一 seed 在客户端 / 服务端 / PK 双方一致。
  return picks.map((pick) => ({
    ...pick,
    question: shuffleOptions(pick.question, seed),
  }));
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

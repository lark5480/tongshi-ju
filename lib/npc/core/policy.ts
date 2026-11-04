/**
 * NPC 引擎 · 决策策略（难度调节器的核心）
 *
 * 裁决 4：NPC 是**难度调节器**，不是聊天机器人 ——
 * 它的输出必须影响玩法：选域权重 + 领域内选题顺序。
 *
 * 裁决 14：出题**可复现靠 PRNG，不靠模型** ——
 * 模型只决定"说什么"（台词），不决定"出什么题"。否则每日挑战会失去确定性，
 * 撞上 AGENTS.md §2.1「每日挑战必须无状态」（题集 = f(日期, 领域集合, 题数)）。
 *
 * ⚠️ **NPC 不改领域集合** —— 领域集合由既有引擎 `resolveDailyDomains` 产出，
 * 且必须"全网一致"（同日期 + 同集合 → 全网同一份题）。若 NPC 改集合，
 * 同一天不同玩家拿到不同题，PK 与分享都失去意义。
 * NPC 的作用只在**集合之内**：哪些域该多练、哪些题该先出。
 */

import type { DomainId, Question } from "@/types";
import { domainName } from "@/content/domains";
import { hashSeed, mulberry32 } from "@/lib/engine/prng";

import type { NpcContext, NpcDecision } from "../types";

/**
 * 「完全掌握」的净答对数刻度。
 *
 * 沿用既有引擎 `masteryStars` 的星级口径（`value / 2`，满星 5 星）
 * → 满星 = **10 次净答对**。不另造数字，避免同一项目里出现两套"熟练"标准。
 */
export const MASTERY_FULL_MARKS = 10;

/**
 * 领域权重（0-1，越大越该练）。
 *
 * 三个信号加权：
 * - **薄弱度** `1 - mastery` —— 掌握度越低越该练；
 * - **错题密度** `wrong / attempts` —— 错得多说明没掌握；
 * - **近期性** —— 最近答错的域优先（新鲜错误更值得补）。
 *
 * 三项按 **0.5 / 0.3 / 0.2** 加权后归一（薄弱度优先、错题密度次之、近期性兜底）。
 */
export function computeDomainWeights(context: NpcContext): Record<string, number> {
  const raw: Record<string, number> = {};

  for (const domain of context.domains) {
    const attempts = context.facts.attemptCounts[domain] ?? 0;
    const wrongs = context.facts.wrongCounts[domain] ?? 0;
    const mastery = context.facts.mastery[domain] ?? 0;

    // 薄弱度：掌握度越低越该练。
    //
    // ⚠️ **mastery 的口径是「单知识点净答对数」，不是 0-1 概率**
    // （既有引擎 `recordMastery`：答对 +1、答错 −1、下界 0；
    //   `masteryStars` 用 `value / 2` → 2 次答对 = 1 星，满星 10 次）。
    //
    // 直接 `1 - clamp01(mastery)` 会把「净答对 1 次」当成「完全掌握」
    // （clamp01(1)=1 → 薄弱度 0）—— 实测会让 NPC **反向推荐**：
    // 玩家刚学的域被跳过、从未碰过的域被推荐。
    //
    // 归一口径沿用既有引擎的星级刻度：**满分 = 10 次净答对**，
    // 即与 `masteryStars` 的满星线一致，不另造数字。
    const masteryRatio = clamp01(mastery / MASTERY_FULL_MARKS);
    const weakness = 1 - masteryRatio;
    // 错题密度：没答过的域不参与（避免"全新域"被当成错题密度 0 而降权）。
    const errorRate = attempts > 0 ? clamp01(wrongs / attempts) : 0;
    // 近期性：最近答错且时间越近 → 越高。用指数衰减按天计。
    const lastSeen = context.facts.lastSeenAt[domain];
    const recency =
      lastSeen === undefined
        ? 0.5 // 从未出现：中性
        : Math.pow(0.9, Math.max(0, (context.now - lastSeen) / 86400000));

    raw[domain] = weakness * 0.5 + errorRate * 0.3 + recency * 0.2;
  }

  return normalizeWeights(raw);
}

/**
 * 领域内选题排序：按"该域的薄弱点"重排题目。
 *
 * 规则（确定性，可复现）：
 * 1. **错题优先** —— 玩家在该域答错过的题排前面；
 * 2. **低掌握度知识点优先** —— 该题所属 topic 的掌握度越低越靠前；
 * 3. **同分用种子稳定排序** —— 保证同 seed 同结果。
 */
export function orderQuestions(params: {
  readonly context: NpcContext;
  readonly domain: DomainId;
}): string[] {
  const { context, domain } = params;
  const pool = context.pool[domain] ?? [];
  if (pool.length === 0) return [];

  const wrongIds = new Set(
    context.episodes.filter((e) => e.domain === domain && !e.correct).map((e) => e.questionId)
  );

  const topicMastery = topicMasteryMap(context);

  const rng = mulberry32(hashSeed("npc-order:" + domain + ":" + context.seed));
  const scored = pool.map((q, index) => {
    // 排序键**降序**（分数大的排前面）→ 错题的权重必须**更大**。
    // 错题权重 2.0 > 未答错题的 1.0，保证「答错过的题优先复习」。
    const wrongBoost = wrongIds.has(q.id) ? 2 : 0;
    // mastery 是**净答对数**，按满星刻度归一后再取"不熟练度"
    // （口径与 `computeDomainWeights` 一致，见 MASTERY_FULL_MARKS）。
    const mastery = topicMastery[`${domain}|${q.topic}`] ?? 0;
    const unfamiliarity = 1 - clamp01(mastery / MASTERY_FULL_MARKS);
    const tie = rng() + index * 1e-9; // 稳定且不改变主序
    return { id: q.id, key: wrongBoost + unfamiliarity + tie };
  });

  scored.sort((a, b) => b.key - a.key || a.id.localeCompare(b.id));
  return scored.map((s) => s.id);
}

/**
 * 完整的 NPC 决策（纯函数）。
 *
 * @param commentary 点评文本（由 `commentary.ts` 生成：有模型用模型，无模型用模板）
 * @param degraded 本次决策是否走了降级路径
 */
export function decideNpc(params: {
  readonly context: NpcContext;
  readonly commentary: string;
  readonly degraded?: boolean;
  readonly degradedReason?: string;
}): NpcDecision {
  const { context } = params;
  const weights = computeDomainWeights(context);

  // 领域排序：全仓唯一实现（点评与决策共用，见 `rankDomains`）。
  const domainOrder = rankDomains(context, weights);

  // 领域内选题：只对**权重最高的域**排序（一次决策只聚焦一个域，保持可解释）。
  const focusDomain = domainOrder[0];
  const questionOrder = focusDomain ? orderQuestions({ context, domain: focusDomain }) : [];

  const rationale = buildRationale(context, weights, domainOrder, focusDomain);

  return {
    domainOrder,
    weights,
    questionOrder,
    commentary: params.commentary,
    degraded: params.degraded ?? false,
    ...(params.degradedReason ? { degradedReason: params.degradedReason } : {}),
    rationale,
  };
}

/**
 * 决策依据摘要（写进报告，供复盘）。
 */
function buildRationale(
  context: NpcContext,
  weights: Record<string, number>,
  domainOrder: readonly DomainId[],
  focusDomain: DomainId | undefined
): string {
  if (!focusDomain) return "无可用领域";
  const attempts = context.facts.attemptCounts[focusDomain] ?? 0;
  const wrongs = context.facts.wrongCounts[focusDomain] ?? 0;
  const mastery = context.facts.mastery[focusDomain] ?? 0;
  const parts = [
    `聚焦 ${domainName(focusDomain)}（权重 ${(weights[focusDomain] ?? 0).toFixed(2)}）`,
    // mastery 是**净答对数**，不是百分比 —— 直接 ×100 会得到「净答对 1 次 = 100%」。
    // 展示为"熟练度 N/10"（满星刻度，见 MASTERY_FULL_MARKS）。
    `熟练度 ${mastery.toFixed(0)}/${MASTERY_FULL_MARKS}`,
    `答 ${attempts} 错 ${wrongs}`,
    `领域顺序 ${domainOrder.map(domainName).join(" > ")}`,
  ];
  return parts.join(" · ");
}

/**
 * 知识点熟练度表（键 `domain|topic`）。
 *
 * **优先用该知识点自己的值**（`facts.topicMastery`，与 `recordMastery` 同口径），
 * 缺失时才回落到所在领域的均值 —— 回落分支只服务两种情况：
 * 1) 旧数据 / 契约升级前构造的上下文没有 `topicMastery`；
 * 2) 该 topic 从未被作答（存储里没有这个键），此时域均值是有意义的先验。
 *
 * 回落是**降级**，不是等价：同域内一个 topic 熟练、另一个生疏时，
 * 用域均值会让两者排序完全相同，等于丢掉了题目级的区分能力。
 */
function topicMasteryMap(context: NpcContext): Record<string, number> {
  const out: Record<string, number> = {};
  const topicFacts = context.facts.topicMastery ?? {};
  for (const domain of context.domains) {
    const domainAverage = context.facts.mastery[domain] ?? 0;
    for (const q of context.pool[domain] ?? []) {
      const key = `${domain}|${q.topic}`;
      out[key] = topicFacts[key] ?? domainAverage;
    }
  }
  return out;
}

/** 归一化权重到 [0,1]，全为 0 时返回等权。 */
function normalizeWeights(raw: Record<string, number>): Record<string, number> {
  const values = Object.values(raw);
  if (values.length === 0) return {};
  const max = Math.max(...values);
  if (max <= 0) {
    const equal = 1 / values.length;
    return Object.fromEntries(Object.keys(raw).map((k) => [k, equal]));
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clamp01(v / max)]));
}

/**
 * 领域优先级排序：权重降序；同权重用**确定性** tie-break（保证可复现、可传递）。
 *
 * 为什么不能用一次性的 `rng()` 比较器：比较器里每次比较都取新的随机数，
 * 结果**不满足传递性**（a>b、b>c 却可能 c>a），不同 V8 版本的排序实现
 * 会给出不同顺序 —— 客户端与服务端、甚至两次刷新之间都可能不一致。
 *
 * 这里为每个领域预计算一个**只依赖 seed 的稳定 key**，比较器全程纯函数：
 * 权重降序 → 稳定 key 升序 → 领域 id 字典序兜底，三段都严格可传递。
 *
 * **全仓唯一的领域排序实现**：`decideNpc` 的 `domainOrder` 与降级点评
 * （`commentary.ts` 的 `pickWeakestDomain`）都调用它，
 * 从而保证"点评点名的域"恒等于 `domainOrder[0]`，不会出现两套口径。
 */
export function rankDomains(
  context: NpcContext,
  weights: Record<string, number> = computeDomainWeights(context)
): DomainId[] {
  const tieKey = new Map<DomainId, number>();
  for (const domain of context.domains) {
    tieKey.set(domain, hashSeed(`npc-domains:${context.seed}:${domain}`));
  }
  return [...context.domains].sort((a, b) => {
    const byWeight = (weights[b] ?? 0) - (weights[a] ?? 0);
    if (byWeight !== 0) return byWeight;
    const bySeed = (tieKey.get(a) ?? 0) - (tieKey.get(b) ?? 0);
    if (bySeed !== 0) return bySeed;
    return a.localeCompare(b);
  });
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

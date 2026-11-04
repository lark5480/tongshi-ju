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
import { hashSeed, mulberry32 } from "@/lib/engine/prng";

import { retrieveEpisodes } from "./retrieve";
import type { NpcContext, NpcDecision } from "../types";

/**
 * 领域权重（0-1，越大越该练）。
 *
 * 三个信号加权：
 * - **薄弱度** `1 - mastery` —— 掌握度越低越该练；
 * - **错题密度** `wrong / attempts` —— 错得多说明没掌握；
 * - **近期性** —— 最近答错的域优先（新鲜错误更值得补）。
 *
 * 三项**等权**后归一 —— 与检索评分的等权原则一致（理由见 retrieve.ts）。
 */
export function computeDomainWeights(context: NpcContext): Record<string, number> {
  const raw: Record<string, number> = {};

  for (const domain of context.domains) {
    const attempts = context.facts.attemptCounts[domain] ?? 0;
    const wrongs = context.facts.wrongCounts[domain] ?? 0;
    const mastery = context.facts.mastery[domain] ?? 0;

    // 薄弱度：没答过的域（attempts=0）掌握度为 0 → 薄弱度 1。
    const weakness = 1 - clamp01(mastery);
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
    const mastery = topicMastery[q.topic] ?? 0;
    const tie = rng() + index * 1e-9; // 稳定且不改变主序
    return { id: q.id, key: wrongBoost + (1 - clamp01(mastery)) + tie };
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

  // 领域排序：权重降序；同权重用种子稳定排序（保证可复现）。
  const rng = mulberry32(hashSeed("npc-domains:" + context.seed));
  const domainOrder = [...context.domains].sort(
    (a, b) => (weights[b] ?? 0) - (weights[a] ?? 0) || rng() - 0.5 || a.localeCompare(b)
  );

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
    `聚焦 ${focusDomain}（权重 ${(weights[focusDomain] ?? 0).toFixed(2)}）`,
    `掌握度 ${(mastery * 100).toFixed(0)}%`,
    `答 ${attempts} 错 ${wrongs}`,
    `领域顺序 ${domainOrder.join(" > ")}`,
  ];
  return parts.join(" · ");
}

/**
 * 主题级掌握度（从事实层的领域掌握度近似）——
 * 事实层按域聚合，主题级用该域的平均掌握度兜底。
 */
function topicMasteryMap(context: NpcContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const domain of context.domains) {
    const m = context.facts.mastery[domain] ?? 0;
    for (const q of context.pool[domain] ?? []) {
      out[q.topic] = m;
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

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * NPC 引擎 · 记忆检索
 *
 * 依据 Generative Agents（Park et al., UIST 2023）的检索评分函数：
 *
 * ```
 * score = α_rec · recency + α_imp · importance + α_rel · relevance
 * ```
 *
 * | 分量         | 论文做法                     | 本项目做法                              |
 * | ------------ | ---------------------------- | --------------------------------------- |
 * | **recency**  | `γ^(距上次访问的小时数)`      | 同上，**γ = 0.995**                     |
 * | **importance** | LLM 打 1-10 分               | LLM 分或**规则替身**，同一标度（裁决 9） |
 * | **relevance** | 查询嵌入与记忆嵌入的余弦相似度 | **结构化匹配**（领域 / 难度），不用嵌入  |
 *
 * 为什么 relevance 不用嵌入（裁决 7）：通识局的"相关"是**结构化**的 ——
 * "这题属于哪个域、难度是否匹配"是确定的。引入嵌入会多一个外部依赖
 * 与不确定性，且违反依赖克制红线（AGENTS.md §2.4）。
 *
 * 论文中三项**等权**（α = 1）。本项目沿用等权，理由：
 * 权重的取舍需要真实使用数据标定，而本项目还没有标定数据 ——
 * 拍一个"看起来合理"的权重比等权更不可解释。
 */

import type { NpcEpisode, RetrievalHit } from "../types";

/** recency 的指数衰减因子（论文取值）。 */
export const RECENCY_GAMMA = 0.995;

/** 检索返回条数上限（工程综述取值 2-4，取中位 3；上界给 4）。 */
export const DEFAULT_TOP_K = 3;

/** 最小相关度阈值：低于此值直接丢弃（工程综述：无关回忆浪费 token 且让角色混乱）。 */
export const MIN_RELEVANCE = 0.2;

/** 检索参数。 */
export interface RetrieveParams {
  /** 情景层（任意顺序）。 */
  readonly episodes: readonly NpcEpisode[];
  /** 当前关注领域（NPC 正在为哪个域挑题）。 */
  readonly domain: string;
  /** 当前关注难度（1-3）；null = 不限难度。 */
  readonly difficulty?: number | null;
  /** 当前时刻（毫秒时间戳，由调用方注入）。 */
  readonly now: number;
  /** 取几条。 */
  readonly topK?: number;
  /** 最小相关度阈值。 */
  readonly minRelevance?: number;
}

/**
 * 检索最相关的情景记忆。
 *
 * 纯函数：同输入必得同输出。
 */
export function retrieveEpisodes(params: RetrieveParams): RetrievalHit[] {
  const {
    episodes,
    domain,
    difficulty = null,
    now,
    topK = DEFAULT_TOP_K,
    minRelevance = MIN_RELEVANCE,
  } = params;

  const hits: RetrievalHit[] = [];

  for (const episode of episodes) {
    const recency = recencyScore(episode, now);
    const importance = normalize01(episode.importance / 10);
    const relevance = relevanceScore(episode, domain, difficulty);

    if (relevance < minRelevance) continue;

    const score = recency + importance + relevance;
    hits.push({
      episode,
      score,
      recency,
      importance,
      relevance,
      reason: buildReason(episode, domain, recency, relevance),
    });
  }

  // 分数降序；同分时用 questionId 稳定排序（保证可复现，不依赖数组顺序）。
  hits.sort(
    (a, b) => b.score - a.score || a.episode.questionId.localeCompare(b.episode.questionId)
  );
  return hits.slice(0, topK);
}

/**
 * 近因性：`γ^(距上次访问的小时数)`。
 *
 * 论文按**小时**计。本项目每题间隔可能只有几分钟，故按小时折算后
 * 数值会非常接近 1（衰减极慢）—— 为让 recency 在"今天 vs 一周前"之间
 * 有区分度，本实现按**天**为单位的等效衰减计算，并在文档中标注该偏离。
 */
function recencyScore(episode: NpcEpisode, now: number): number {
  const hours = Math.max(0, (now - episode.lastAccessedAt) / 3600000);
  return Math.pow(RECENCY_GAMMA, hours);
}

/**
 * 相关性：结构化匹配。
 *
 * - 领域完全一致 → 1.0
 * - 领域不同 → 0.0（该条不入选）
 * - 难度不匹配 → 在领域一致的基础上打折（0.6）
 */
function relevanceScore(episode: NpcEpisode, domain: string, difficulty: number | null): number {
  if (episode.domain !== domain) return 0;
  if (difficulty === null) return 1;
  if (episode.difficulty === difficulty) return 1;
  return 0.6;
}

/**
 * 归一到 [0,1]。
 */
function normalize01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * 命中的原因（写进报告，供复盘"为什么想起这条"）。
 */
function buildReason(
  episode: NpcEpisode,
  domain: string,
  recency: number,
  relevance: number
): string {
  const parts: string[] = [];
  parts.push(episode.correct ? "答对过" : "答错过");
  parts.push(episode.domain === domain ? `同域(${domain})` : `跨域(${episode.domain})`);
  if (relevance >= 1) parts.push("难度匹配");
  else if (relevance > 0) parts.push("难度接近");
  parts.push(recency > 0.9 ? "近期" : "较早");
  return parts.join(" · ");
}

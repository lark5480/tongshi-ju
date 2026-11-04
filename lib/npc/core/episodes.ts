/**
 * NPC 引擎 · 情景层（记忆流）
 *
 * 依据 Generative Agents（Park et al., UIST 2023）：记忆流是**只追加**的
 * 自然语言观察记录，随时间持续增长，**永不整体进 prompt** ——
 * 每次决策只检索出最相关的一小部分。
 *
 * 本项目的实现差别：条目不存自然语言（通识局的"观察"是结构化答题事件，
 * 存成文本反而丢信息），其余性质（只追加、带时间戳、带重要度、只检索子集）一致。
 */

import type { NpcEpisode, AnswerEvent } from "../types";

import { computeImportance } from "./importance";

/**
 * 由一次答题事件构造情景条目。
 *
 * @param isNewDomain 该领域是否首次触达
 * @param modelImportance 模型给出的重要度；`null`/缺省 → 走规则打分（降级路径）
 */
export function toEpisode(params: {
  readonly event: AnswerEvent;
  readonly isNewDomain: boolean;
  readonly modelImportance?: number | null;
}): NpcEpisode {
  const importance = computeImportance({
    event: params.event,
    isNewDomain: params.isNewDomain,
    modelScore: params.modelImportance ?? null,
  });
  return {
    questionId: params.event.questionId,
    domain: params.event.domain,
    topic: params.event.topic,
    difficulty: params.event.difficulty,
    correct: params.event.correct,
    at: params.event.at,
    importance,
    lastAccessedAt: params.event.at,
  };
}

/**
 * 追加一条情景（**只增不改**，新条目在前）。
 *
 * 返回新数组 —— 不改原数组（纯函数）。泛型保留条目的扩展字段。
 */
export function appendEpisode<T extends NpcEpisode>(episodes: readonly T[], episode: T): T[] {
  return [episode, ...episodes];
}

/**
 * 标记一条记忆"刚被检索到"（更新 lastAccessedAt —— recency 衰减的基准）。
 *
 * 返回新数组；未命中的 id 不影响结果。
 */
export function touchEpisode(
  episodes: readonly NpcEpisode[],
  questionId: string,
  at: number
): NpcEpisode[] {
  return episodes.map((e) => (e.questionId === questionId ? { ...e, lastAccessedAt: at } : e));
}

/**
 * 情景层容量上限（超出后丢弃最旧的）。
 *
 * Generative Agents 的记忆流是"无界增长"，但通识局是**每天 5 题**的轻量场景 ——
 * 无界存储既无必要也不友好。保留最近 N 条足够支撑"跨会话记住薄弱域"这个目标。
 *
 * 数值依据：每天 5 题 → 保留 200 条 ≈ 40 天的答题史；
 * 而 recency 衰减（γ=0.995 按小时）会让 40 天前的条目权重趋近于 0，实际检索不到。
 */
export const MAX_EPISODES = 200;

/**
 * 追加并按容量裁剪（丢弃最旧的）。
 *
 * 泛型保留条目自身的扩展字段（如 `StoredEpisode` 的 `userId`），
 * 否则分区存储时会把附加字段丢掉。
 */
export function appendEpisodeCapped<T extends NpcEpisode>(
  episodes: readonly T[],
  episode: T,
  max = MAX_EPISODES
): T[] {
  const next = appendEpisode(episodes, episode);
  return next.length > max ? next.slice(0, max) : next;
}

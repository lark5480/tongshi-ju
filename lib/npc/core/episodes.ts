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
  /** 模型重要度不可用 / 失败的原因（降级要留痕，不能静默）。 */
  readonly importanceDegradedReason?: string;
}): NpcEpisode {
  const usedModel = params.modelImportance !== null && params.modelImportance !== undefined;
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
    // 来源原样保留（旧事件没有该字段时不补写，读取方按 public 处理）。
    ...(params.event.source ? { source: params.event.source } : {}),
    at: params.event.at,
    importance,
    importanceSource: usedModel ? "model" : "rule",
    importanceDegraded: !usedModel,
    ...(!usedModel
      ? {
          importanceDegradedReason:
            params.importanceDegradedReason ?? "未提供模型重要度，使用规则打分",
        }
      : {}),
    lastAccessedAt: params.event.at,
  };
}

/**
 * 由一次作答构造 NPC 事件。
 *
 * `combo` 必须是**本局真实连击**（`useDailyChallenge` 的 `combo` 状态，
 * 由 `nextCombo` 在跨域答对时累加、答错归零），不得默认传 0。
 *
 * 为什么用本局连击、而不是错题本 `WrongEntry.streak`（`AnswerEvent.streak`
 * 原注释写的出处）：错题本连续答对 2 次即毕业（`GRADUATE_STREAK = 2`），
 * 那条 streak 的最大值是 1，`ruleImportance` 的 `floor(streak / 2)`
 * 永远为 0 —— 连击降权不可能生效。本局连击是项目里唯一能超过 1 的真实连击来源。
 */
export function buildAnswerEvent(params: {
  readonly questionId: string;
  readonly domain: AnswerEvent["domain"];
  readonly topic: string;
  readonly difficulty: number;
  readonly correct: boolean;
  /** 本局连击（真实值，0 表示答错或尚未起连）。 */
  readonly combo: number;
  /** 作答来源：`public` = 公共题；`practice` = 第 5 题加练（不计分）。 */
  readonly source?: AnswerEvent["source"];
  readonly at: number;
}): AnswerEvent {
  const streak = Number.isFinite(params.combo) ? Math.max(0, Math.floor(params.combo)) : 0;
  return {
    questionId: params.questionId,
    domain: params.domain,
    topic: params.topic,
    difficulty: params.difficulty,
    correct: params.correct,
    streak,
    ...(params.source ? { source: params.source } : {}),
    at: params.at,
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

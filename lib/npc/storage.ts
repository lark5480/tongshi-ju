/**
 * NPC 引擎 · 宿主接入层
 *
 * 把 NPC 接到**既有数据**上：读既有引擎产出的熟练度 / 错题本 / 历史，
 * 产出 NPC 决策。**不修改 `lib/engine/*`，不新增任何状态源**。
 *
 * 记忆的存储（裁决 15：按用户隔离）：
 * - 事实层（mastery / 错题 / 历史）—— 直接来自既有存储，**不复制**；
 * - 情景层（答题事件流）—— NPC 自己维护一份 `npc-episodes`，
 *   按 `userId` 分区，追加写。
 *
 * 情景层为什么不复用既有历史？
 * 既有历史（`pushHistory`）是**每局一条汇总**，粒度太粗（不知道单题对错）。
 * NPC 需要单题事件流才能算重要度与近因性 —— 但它**不重复造轮子**：
 * 既有 `recordAttempt` 已经在记录单题对错，NPC 只需要在同一时刻
 * 追加一条自己的情景条目，两者共享同一个数据源（这次作答）。
 */

import type { DomainId, Question } from "@/types";

import { buildFacts, isNewDomain } from "./core/facts";
import { appendEpisodeCapped, toEpisode } from "./core/episodes";
import type { AnswerEvent, NpcContext, NpcEpisode, NpcFacts } from "./types";

/**
 * NPC 情景层的存储键（按用户隔离，裁决 15）。
 */
export const NPC_EPISODES_KEY = "npc-episodes";

/**
 * NPC 情景层的持久化条目 —— 带 `userId` 分区。
 */
export interface StoredEpisode extends NpcEpisode {
  readonly userId: string;
}

/**
 * 从既有存储读取某用户的 NPC 情景层。
 *
 * @param read 读取函数（由宿主注入，便于测试与 SSR）
 */
export function loadEpisodes(read: (key: string) => StoredEpisode[], userId: string): NpcEpisode[] {
  return read(NPC_EPISODES_KEY).filter((e) => e.userId === userId);
}

/**
 * 追加一条情景并按用户分区持久化。
 *
 * @param write 写入函数（由宿主注入）
 */
export function saveEpisode(
  write: (episodes: StoredEpisode[]) => void,
  read: (key: string) => StoredEpisode[],
  episode: StoredEpisode
): void {
  const all = read(NPC_EPISODES_KEY);
  const mine = all.filter((e) => e.userId === episode.userId);
  const nextMine = appendEpisodeCapped(mine, episode);
  const others = all.filter((e) => e.userId !== episode.userId);
  write([...others, ...nextMine]);
}

/**
 * 从既有引擎的数据构造 NPC 上下文。
 *
 * **只读**既有数据 —— mastery / 错题本 / 历史都不复制、不改写。
 *
 * @param params.mastery 既有引擎的熟练度（`domain|topic` → 熟练度）
 * @param params.wrongEntries 既有引擎的错题队列
 * @param params.history 既有引擎的历史（每局一条汇总）
 * @param params.episodes NPC 自己的情景层
 */
export function buildNpcContext(params: {
  readonly userId: string;
  readonly domains: readonly DomainId[];
  readonly pool: Partial<Record<DomainId, Question[]>>;
  readonly mastery: Readonly<Record<string, number>>;
  readonly wrongEntries: readonly { domain: DomainId; wrongCount: number }[];
  readonly history: readonly { domains: readonly DomainId[]; correct: number; total: number }[];
  readonly episodes: readonly NpcEpisode[];
  readonly seed: number;
  readonly now: number;
}): NpcContext {
  const attemptCounts: Record<string, number> = {};
  const wrongCounts: Record<string, number> = {};
  const lastSeenAt: Record<string, number> = {};

  // 错题本 → 累计答错次数
  for (const entry of params.wrongEntries) {
    wrongCounts[entry.domain] = (wrongCounts[entry.domain] ?? 0) + entry.wrongCount;
  }

  // 历史 → 累计答题次数（每局 total 次）
  for (const h of params.history) {
    for (const domain of h.domains) {
      attemptCounts[domain] = (attemptCounts[domain] ?? 0) + h.total;
    }
  }

  // 情景层 → 累计答题次数（更精确：单题粒度）+ 最近答题时刻
  for (const ep of params.episodes) {
    attemptCounts[ep.domain] = (attemptCounts[ep.domain] ?? 0) + 1;
    const prev = lastSeenAt[ep.domain] ?? 0;
    if (ep.at > prev) lastSeenAt[ep.domain] = ep.at;
  }

  // 历史里的 correct 只用于估算，不覆盖错题本
  const facts: NpcFacts = buildFacts({
    mastery: params.mastery,
    attemptCounts,
    wrongCounts,
    lastSeenAt,
  });

  return {
    userId: params.userId,
    domains: params.domains,
    pool: params.pool,
    facts,
    episodes: params.episodes,
    seed: params.seed,
    now: params.now,
  };
}

/**
 * 由一次作答事件构造并持久化 NPC 情景条目。
 *
 * @param importance 模型给出的重要度；`null`/缺省 → 规则打分（降级路径，裁决 9）
 */
export function recordNpcEpisode(params: {
  readonly write: (episodes: StoredEpisode[]) => void;
  readonly read: (key: string) => StoredEpisode[];
  readonly userId: string;
  readonly event: AnswerEvent;
  readonly facts: NpcFacts;
  readonly importance?: number | null;
}): StoredEpisode {
  const isNew = isNewDomain(params.facts, params.event.domain);
  const episode: StoredEpisode = {
    ...toEpisode({
      event: params.event,
      isNewDomain: isNew,
      modelImportance: params.importance ?? null,
    }),
    userId: params.userId,
  };
  saveEpisode(params.write, params.read, episode);
  return episode;
}

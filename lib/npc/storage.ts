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
import { normalizeImportance } from "./core/importance";
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

  // 情景层 → 累计答题次数（单题粒度）+ 最近答题时刻
  //
  // **情景层是 attemptCounts 的唯一精确来源**：一条对应一次作答、按用户分区，
  // 能直接落到具体领域。
  for (const ep of params.episodes) {
    attemptCounts[ep.domain] = (attemptCounts[ep.domain] ?? 0) + 1;
    const prev = lastSeenAt[ep.domain] ?? 0;
    if (ep.at > prev) lastSeenAt[ep.domain] = ep.at;
  }

  // 历史 → 只做**下限补位**，不再与情景层相加。
  //
  // 为什么不能像以前那样把 `h.total` 加到该局的每个域上、也不能与情景层求和：
  // 1) history 是**每局汇总**（只有 domains / total），无法拆分到具体域 ——
  //    把整局题量摊给每个域会凭空放大该域的答题数；
  // 2) history 与情景层覆盖的是**同一批近期作答**（每日挑战每题进情景层，
  //    结算时同一局又进 history），相加 = 同一次作答被计两次。
  //
  // 口径：情景层里出现过的域一律以情景层为准；没有情景记录的域
  // （如只在 duel 里答过、或情景层被清空）用"涉及该域的历史场次数"作为**下限**，
  // 只保证 `isNewDomain` 不误判成"从未碰过"，且 errorRate 的分母不为 0。
  const episodeDomains = new Set<string>();
  for (const ep of params.episodes) episodeDomains.add(ep.domain);

  const historySessions: Record<string, number> = {};
  for (const h of params.history) {
    for (const domain of h.domains) {
      if (episodeDomains.has(domain)) continue;
      historySessions[domain] = (historySessions[domain] ?? 0) + 1;
    }
  }
  for (const [domain, sessions] of Object.entries(historySessions)) {
    attemptCounts[domain] = Math.max(attemptCounts[domain] ?? 0, sessions);
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
  /** 模型重要度不可用 / 失败的原因（降级留痕）。 */
  readonly importanceDegradedReason?: string;
}): StoredEpisode {
  const isNew = isNewDomain(params.facts, params.event.domain);
  const episode: StoredEpisode = {
    ...toEpisode({
      event: params.event,
      isNewDomain: isNew,
      modelImportance: params.importance ?? null,
      importanceDegradedReason: params.importanceDegradedReason,
    }),
    userId: params.userId,
  };
  saveEpisode(params.write, params.read, episode);
  return episode;
}

/**
 * 情景条目的稳定标识（同一 `userId` 下由题目 id + 事件时刻唯一确定）。
 *
 * 为什么不用自增 id：情景层要跨设备 / 跨刷新保持一致，
 * `questionId + at` 是事件本身携带的信息，不需要额外维护计数器。
 */
export function episodeId(episode: Pick<NpcEpisode, "questionId" | "at">): string {
  return `${episode.questionId}@${episode.at}`;
}

/**
 * 模型重要度回来后，**就地升级**已经落盘的情景条目。
 *
 * 背景：事件必须在作答当下**同步落盘**（用户可能立刻关页），
 * 但模型打分是异步的。因此先用规则分写一条，模型返回后再升级这条：
 *
 * - `modelImportance` 有值 → 覆盖重要度、`importanceSource: "model"`、清除降级标记；
 * - `modelImportance` 为 `null`（模型失败 / 不可用）→ **保持规则分**，
 *   只更新降级原因（不静默降级）；
 * - 找不到该条目（已被容量上限淘汰 / 已被清理）→ 返回 `null`，**不重建** ——
 *   否则会把一条本该淘汰的旧记忆"复活"，让容量上限失效。
 *
 * @returns 更新后的条目；未找到时为 `null`
 */
export function updateEpisodeImportance(params: {
  readonly write: (episodes: StoredEpisode[]) => void;
  readonly read: (key: string) => StoredEpisode[];
  readonly userId: string;
  readonly id: string;
  readonly modelImportance: number | null;
  readonly degradedReason?: string;
}): StoredEpisode | null {
  const all = params.read(NPC_EPISODES_KEY);
  const index = all.findIndex((e) => e.userId === params.userId && episodeId(e) === params.id);
  if (index < 0) return null;

  const current = all[index];
  const next: StoredEpisode =
    params.modelImportance === null
      ? {
          ...current,
          importanceSource: "rule",
          importanceDegraded: true,
          importanceDegradedReason: params.degradedReason ?? "模型重要度不可用，保持规则分",
        }
      : {
          ...current,
          importance: normalizeImportance(params.modelImportance),
          importanceSource: "model",
          importanceDegraded: false,
        };
  if (params.modelImportance !== null) {
    // 模型成功时不保留旧的降级原因（成功路径没有降级）。
    delete (next as unknown as { importanceDegradedReason?: string }).importanceDegradedReason;
  }

  const nextAll = [...all];
  nextAll[index] = next;
  params.write(nextAll);
  return next;
}

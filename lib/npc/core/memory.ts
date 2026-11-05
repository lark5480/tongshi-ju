/**
 * NPC 引擎 · 玩家可见的记忆选择
 *
 * 检索的**打分**留在 `retrieve.ts`（内部治理证据）；本模块只做两件事：
 * 1. 从检索命中里挑出最多 2 条给面板看；
 * 2. 把内部 reason 翻译成玩家能读的中文。
 *
 * 为什么单独一层：面板不应该看到 `同域(gaming) · 难度匹配` 这类内部术语，
 * 也不应该拿到检索分数。同一份 `DecisionMemory` 同时喂 prompt 与界面，
 * 保证“模型说的”和“玩家看到的”是同一批记忆。
 */

import { domainName } from "@/content/domains";

import type { DecisionMemory, NpcEpisode } from "../types";
import { retrieveEpisodes } from "./retrieve";

/** 面板最多展示几条（工程综述：2-4 条，取最小值避免挤占结算页）。 */
export const PLAYER_MEMORY_LIMIT = 2;

/** 检索先多取几条，去重后再截断，避免同题重复作答把名额吃光。 */
const RETRIEVE_CANDIDATES = 4;

/**
 * 选出焦点域下最值得提起的记忆。
 *
 * 纯函数：`now` 由调用方注入，不读时钟。
 *
 * @param domain 焦点域由调用方传入（`decideNpc` 的 `domainOrder[0]`），
 *   避免本模块反过来 import `policy.ts` 形成循环依赖。
 */
export function selectMemories(params: {
  readonly episodes: readonly NpcEpisode[];
  readonly domain: string;
  readonly now: number;
  readonly limit?: number;
}): DecisionMemory[] {
  const limit = Math.max(0, params.limit ?? PLAYER_MEMORY_LIMIT);
  if (!params.domain || limit === 0 || params.episodes.length === 0) return [];

  const hits = retrieveEpisodes({
    episodes: params.episodes,
    domain: params.domain,
    difficulty: null,
    now: params.now,
    topK: RETRIEVE_CANDIDATES,
  });

  // 同一道题可能被答过多次；同一知识点的同一种结果也只留一条 ——
  // 两条「历史·文化 · 节日与习俗」答错过并排展示，对玩家没有增量信息。
  const seen = new Set<string>();
  const out: DecisionMemory[] = [];
  for (const hit of hits) {
    const { episode } = hit;
    const key = `${episode.domain}|${episode.topic}|${episode.correct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      questionId: episode.questionId,
      domain: episode.domain,
      topic: episode.topic,
      correct: episode.correct,
      at: episode.at,
      reason: formatMemoryReason(episode, params.now),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 玩家可读理由：`「游戏 · 主机与PC」答错过 · 3 天前`。
 *
 * 不出现英文域 id，也不出现“同域 / 跨域 / 难度匹配 / 近期”等内部口径。
 */
export function formatMemoryReason(
  episode: Pick<NpcEpisode, "domain" | "topic" | "correct" | "at">,
  now: number
): string {
  const label = domainName(episode.domain);
  const where = episode.topic ? `${label} · ${episode.topic}` : label;
  const what = episode.correct ? "答对过" : "答错过";
  return `「${where}」${what} · ${relativeDay(episode.at, now)}`;
}

/** 天数差：负数（时钟偏差 / 未来时间）按“今天”处理。 */
function relativeDay(at: number, now: number): string {
  const days = Math.max(0, Math.floor((now - at) / 86400000));
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  return `${days} 天前`;
}

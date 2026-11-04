/**
 * NPC · 第 5 题「个人加练」选题
 *
 * 4+1 分轨（见 AGENTS.md §2.1）：前 4 题全网同题并计分，第 5 题由 NPC 依据
 * 本人的熟练度从题库另选 —— 只用于学习进度（仍写 mastery），**不计分、不计排名**。
 *
 * 纯函数：同 seed + 同事实 → 同题；不读时钟、不读全局状态。
 */

import type { DomainId, Question } from "@/types";
import { domainName } from "@/content/domains";
import { hashSeed, mulberry32 } from "@/lib/engine/prng";
import { shuffleOptions } from "@/lib/engine/options";

import type { NpcContext } from "../types";
import { MASTERY_FULL_MARKS, rankDomains } from "./policy";

export interface PracticePick {
  readonly question: Question;
  /** 给玩家看的一句依据（如「你在科技错了 3 次」）。 */
  readonly reason: string;
}

/**
 * 选一道加练题。
 *
 * 规则（按优先级）：
 * 1. 领域用 `rankDomains` 的顺序 —— 最该练的域优先；
 * 2. 域内按该题所属 topic 的熟练度**升序** —— 最生疏的知识点优先；
 * 3. 排除 `excludeIds`（前 4 题已出现的题），同域取完就换下一个域；
 * 4. 同熟练度用种子稳定排序 —— 同 seed + 同事实可复现。
 *
 * 返回 `undefined` 表示没有可用的新题（调用方回落到原来的第 5 题）。
 */
export function pickPracticeQuestion(params: {
  readonly context: NpcContext;
  readonly excludeIds: ReadonlySet<string>;
}): PracticePick | undefined {
  const { context, excludeIds } = params;
  const topicFacts = context.facts.topicMastery ?? {};

  for (const domain of rankDomains(context)) {
    const candidates = (context.pool[domain] ?? []).filter((q) => !excludeIds.has(q.id));
    if (candidates.length === 0) continue;

    const rng = mulberry32(hashSeed("npc-practice:" + context.seed + ":" + domain));
    const scored = candidates.map((question, index) => {
      // 知识点原值优先；该 topic 从未作答时回落该域均值。
      const mastery =
        topicFacts[`${domain}|${question.topic}`] ?? context.facts.mastery[domain] ?? 0;
      return { question, mastery, tie: rng() + index * 1e-9 };
    });
    scored.sort(
      (a, b) => a.mastery - b.mastery || a.tie - b.tie || a.question.id.localeCompare(b.question.id)
    );

    const question = scored[0]!.question;
    return {
      question: shuffleOptions(question, context.seed),
      reason: buildReason(context, domain),
    };
  }

  return undefined;
}

/** 依据文案：优先说错题次数（玩家最容易理解），没有错题就说熟练度。 */
function buildReason(context: NpcContext, domain: DomainId): string {
  const name = domainName(domain);
  const wrongs = context.facts.wrongCounts[domain] ?? 0;
  if (wrongs > 0) return `你在${name}错了 ${wrongs} 次，今天补一题`;
  const mastery = context.facts.mastery[domain] ?? 0;
  return `你在${name}的熟练度是 ${mastery.toFixed(0)}/${MASTERY_FULL_MARKS}，今天补一题`;
}

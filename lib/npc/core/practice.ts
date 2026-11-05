/**
 * NPC · 第 5 题「个人加练」选题
 *
 * 4+1 分轨（见 AGENTS.md §2.1）：前 4 题全网同题并计分，第 5 题由 NPC 依据
 * 本人的熟练度从题库另选 —— 只用于学习进度（仍写 mastery），**不计分、不计排名**。
 *
 * 结算时的叙事选择只通过 `focus` 改变这一题的**策略**：
 * 继续补最弱项 / 换个轻松领域 / 听老师安排。缺省 `focus` 时与旧行为逐字一致。
 *
 * 纯函数：同 seed + 同事实 + 同 focus → 同题；不读时钟、不读全局状态。
 */

import type { BranchOptionId, DomainId, Question } from "@/types";
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

export interface PracticeFocus {
  readonly strategy: BranchOptionId;
  /** 昨日计划指向的域；不在今日集合时忽略。 */
  readonly domain?: DomainId;
  /** 昨日计划指向的知识点；今日候选里有同名 topic 时优先。 */
  readonly topic?: string;
}

/**
 * 选一道加练题。
 *
 * 有 `focus` 时先按策略选；策略没有候选（被前 4 题排除完）则回落默认逻辑。
 * 默认逻辑（原行为）：
 * 1. 领域用 `rankDomains` 的顺序 —— 最该练的域优先；
 * 2. 域内按该题所属 topic 的熟练度**升序** —— 最生疏的知识点优先；
 * 3. 排除 `excludeIds`（前 4 题已出现的题），同域取完就换下一个域；
 * 4. 同熟练度用种子稳定排序 —— 同 seed + 同事实可复现。
 */
export function pickPracticeQuestion(params: {
  readonly context: NpcContext;
  readonly excludeIds: ReadonlySet<string>;
  readonly focus?: PracticeFocus;
}): PracticePick | undefined {
  const { context, excludeIds, focus } = params;
  if (!focus) return pickDefault(context, excludeIds);
  return pickByFocus({ context, excludeIds, focus }) ?? pickDefault(context, excludeIds);
}

/** 原默认逻辑（不传 focus 时逐字不变）。 */
function pickDefault(
  context: NpcContext,
  excludeIds: ReadonlySet<string>
): PracticePick | undefined {
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

    return finish(context, scored[0]!.question, buildReason(context, domain));
  }

  return undefined;
}

function pickByFocus(params: {
  readonly context: NpcContext;
  readonly excludeIds: ReadonlySet<string>;
  readonly focus: PracticeFocus;
}): PracticePick | undefined {
  const { context, excludeIds, focus } = params;
  const order = rankDomains(context);
  const topicFacts = context.facts.topicMastery ?? {};

  if (focus.strategy === "switch-easy") {
    // 最省练的域优先；域内先做难度 1，再优先已经熟的知识点。
    for (const domain of [...order].reverse()) {
      const candidates = available(context, excludeIds, domain);
      if (candidates.length === 0) continue;
      const scored = candidates.map((question) => ({
        question,
        mastery: topicMastery(context, domain, question),
        tie: stableTie(context, domain, question),
      }));
      scored.sort(
        (a, b) =>
          a.question.difficulty - b.question.difficulty ||
          b.mastery - a.mastery ||
          a.tie - b.tie ||
          a.question.id.localeCompare(b.question.id)
      );
      return finish(
        context,
        scored[0]!.question,
        `按昨天约定：换轻松的「${domainName(domain)}」，先做简单题`
      );
    }
    return undefined;
  }

  if (focus.strategy === "follow-teacher") {
    // 第二弱的域；只有一个域时回落最弱域（与 continue 的步骤不同）。
    const ordered = order.length > 1 ? [order[1]!, ...order.filter((_, i) => i !== 1)] : order;
    for (const domain of ordered) {
      const candidates = available(context, excludeIds, domain);
      if (candidates.length === 0) continue;
      const picked = lowestMastery(context, domain, candidates, topicFacts);
      return finish(context, picked, `按老师安排：今天从「${domainName(domain)}」的最低知识点开始`);
    }
    return undefined;
  }

  // continue-weak：昨日知识点在今天候选里就优先它（先昨日域，再跨今日域找同名 topic）。
  if (focus.topic) {
    const preferred = focus.domain && order.includes(focus.domain) ? focus.domain : undefined;
    const domains = preferred ? [preferred, ...order.filter((d) => d !== preferred)] : order;
    for (const domain of domains) {
      const candidates = available(context, excludeIds, domain).filter(
        (q) => q.topic === focus.topic
      );
      if (candidates.length === 0) continue;
      const picked = lowestMastery(context, domain, candidates, topicFacts);
      return finish(
        context,
        picked,
        `按昨天约定：继续补「${domainName(domain)}」的「${focus.topic}」`
      );
    }
  }

  // 没有可用的 topic 目标 → 交给默认逻辑（reason 也回到旧文案）。
  return undefined;
}

function available(
  context: NpcContext,
  excludeIds: ReadonlySet<string>,
  domain: DomainId
): Question[] {
  return (context.pool[domain] ?? []).filter((q) => !excludeIds.has(q.id));
}

function topicMastery(context: NpcContext, domain: DomainId, question: Question): number {
  return (
    context.facts.topicMastery?.[`${domain}|${question.topic}`] ??
    context.facts.mastery[domain] ??
    0
  );
}

function stableTie(context: NpcContext, domain: DomainId, question: Question): number {
  return hashSeed("npc-practice-tie:" + context.seed + ":" + domain + ":" + question.id);
}

function lowestMastery(
  context: NpcContext,
  domain: DomainId,
  candidates: readonly Question[],
  topicFacts: Readonly<Record<string, number>>
): Question {
  return [...candidates].sort((a, b) => {
    const ma = topicFacts[`${domain}|${a.topic}`] ?? context.facts.mastery[domain] ?? 0;
    const mb = topicFacts[`${domain}|${b.topic}`] ?? context.facts.mastery[domain] ?? 0;
    return (
      ma - mb ||
      stableTie(context, domain, a) - stableTie(context, domain, b) ||
      a.id.localeCompare(b.id)
    );
  })[0]!;
}

function finish(context: NpcContext, question: Question, reason: string): PracticePick {
  return {
    question: shuffleOptions(question, context.seed),
    reason,
  };
}

/** 依据文案：优先说错题次数（玩家最容易理解），没有错题就说熟练度。 */
function buildReason(context: NpcContext, domain: DomainId): string {
  const name = domainName(domain);
  const wrongs = context.facts.wrongCounts[domain] ?? 0;
  if (wrongs > 0) return `你在${name}错了 ${wrongs} 次，今天补一题`;
  const mastery = context.facts.mastery[domain] ?? 0;
  return `你在${name}的熟练度是 ${mastery.toFixed(0)}/${MASTERY_FULL_MARKS}，今天补一题`;
}

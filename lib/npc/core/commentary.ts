/**
 * NPC 引擎 · 点评生成与降级
 *
 * 裁决 13：LLM 只在两处介入 —— ① 意图分类 ② **台词生成**。
 * 裁决 9 的配套：**降级是一等公民** —— 没有模型端点时，NPC 依然有话说，
 * 且说的内容由**确定性模板**生成（同样的状态 → 同样的话），可复现。
 *
 * 降级文案不是"凑合话"，而是**基于事实的真实诊断** ——
 * 它说的是玩家真实的状态（哪个域最弱、错了几次），只是措辞机械。
 */

import type { DomainId } from "@/types";

import type { NpcContext } from "../types";
import { MASTERY_FULL_MARKS } from "./policy";

/**
 * 找出最该练的领域（权重最高）。
 *
 * 权重口径与 `policy.ts` 一致：薄弱度 × 0.5 + 错题密度 × 0.3。
 * 这里独立实现（不 import policy）是为了让降级路径**不依赖**策略模块，
 * 避免降级时因某个模块出错而连带失败。
 */
export function pickWeakestDomain(context: NpcContext): DomainId | undefined {
  let best: DomainId | undefined;
  let bestScore = -Infinity;
  for (const domain of context.domains) {
    const attempts = context.facts.attemptCounts[domain] ?? 0;
    const wrongs = context.facts.wrongCounts[domain] ?? 0;
    const mastery = context.facts.mastery[domain] ?? 0;
    // mastery 是**净答对数**，按满星刻度归一（口径同 policy.ts）。
    const weakness = 1 - clamp01(mastery / MASTERY_FULL_MARKS);
    const errorRate = attempts > 0 ? clamp01(wrongs / attempts) : 0;
    const score = weakness * 0.5 + errorRate * 0.3;
    if (score > bestScore) {
      bestScore = score;
      best = domain;
    }
  }
  return best;
}

/**
 * 生成确定性点评（降级路径）。
 *
 * 文案随事实变化 —— 域不同、答错次数不同、掌握度不同 → 话不同。
 * 同状态 → 同话（可复现）。
 */
export function buildCommentary(context: NpcContext): string {
  const domain = pickWeakestDomain(context);
  if (!domain) return "今天没有可点评的领域，先去答几道题吧。";

  const attempts = context.facts.attemptCounts[domain] ?? 0;
  const wrongs = context.facts.wrongCounts[domain] ?? 0;
  const mastery = context.facts.mastery[domain] ?? 0;

  if (attempts === 0) {
    return `「${domain}」你还没碰过。今天先从它开始 —— 新领域的记忆最值钱。`;
  }

  const parts: string[] = [];

  if (wrongs > 0) {
    parts.push(`「${domain}」错过 ${wrongs} 次`);
  } else {
    parts.push(`「${domain}」目前没错过`);
  }

  // 阈值按**满星刻度**判定（mastery 是净答对数，满星 = 10 次）。
  // 用绝对阈值 0.3 / 0.7 判净答对数会把「净答对 1 次」说成"掌握得不错"。
  const masteryRatio = clamp01(mastery / MASTERY_FULL_MARKS);
  if (masteryRatio < 0.3) {
    parts.push("掌握度偏低，今天多练它");
  } else if (masteryRatio < 0.7) {
    parts.push("掌握度中等，巩固一下");
  } else {
    parts.push("掌握得不错，可以往后放");
  }

  return parts.join("，") + "。";
}

/**
 * 钳制到 [0,1]。
 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

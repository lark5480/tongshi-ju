/**
 * NPC 引擎 · 重要度打分
 *
 * 依据 Generative Agents（Park et al., UIST 2023）：记忆带一个 1-10 的
 * importance 分量，由模型评估其意义大小。
 *
 * 但本项目有**降级承诺**（裁决 9）：无模型端点时也必须能玩。
 * 因此 importance 有两个来源，**落在同一 [1,10] 标度**：
 *
 * | 来源          | 场景                 | 依据                             |
 * | ------------- | -------------------- | -------------------------------- |
 * | `llm`         | 有模型端点           | 论文原做法（LLM 打 1-10 分）     |
 * | `rule`（降级） | 无模型端点 / 模型失败 | 规则打分（见 `ruleImportance`）  |
 *
 * 标度对齐的意义：降级前后的**相对排序**要保持可比，
 * 否则"有模型时记得更准、降级时完全乱序"，行为无法解释。
 */

import type { AnswerEvent } from "../types";

/** 重要度的取值范围（与论文一致：约 1-10）。 */
export const IMPORTANCE_MIN = 1;
export const IMPORTANCE_MAX = 10;

/**
 * 规则重要度：答错的记忆比答对的更重要。
 *
 * 分档（裁决 16 的起点值，实现后按真实答题事件分布标定）：
 * - **答错** → 10（最该记住的就是错题）
 * - **首次答对新领域** → 6（新知识有留存价值）
 * - **重复答对** → 3（已掌握，价值递减）
 *
 * 连击会**下调**重要度：连对说明已经掌握，不必反复占用检索名额。
 */
export function ruleImportance(event: AnswerEvent, isNewDomain: boolean): number {
  let base: number;
  if (!event.correct) {
    base = 10;
  } else {
    base = isNewDomain ? 6 : 3;
  }
  // 连击越高 → 越可能已掌握 → 重要度下调（最低 1）。
  const comboPenalty = Math.min(3, Math.floor(event.streak / 2));
  return clampImportance(base - comboPenalty);
}

/**
 * 把任意来源的重要度**归一到 [1,10]**。
 *
 * 模型可能给 0 或 11，离散化后取整并钳制 —— 归一必须在**本侧**做，
 * 不能指望服务端（与 playtest-agent 的 canonicalize 同理）。
 */
export function normalizeImportance(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 5;
  return clampImportance(Math.round(n));
}

/** 钳制到 [1,10]。 */
function clampImportance(v: number): number {
  if (!Number.isFinite(v)) return 5;
  return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, Math.round(v)));
}

/**
 * 综合打分：优先用模型分；不可用时用规则分。
 *
 * @param modelScore 模型给出的重要度（1-10）；`null`/缺省表示模型不可用 → 走规则分
 * @param isNewDomain 该题所属领域是否是玩家**首次触达**（由事实层的 attemptCounts 判定）
 */
export function computeImportance(params: {
  readonly event: AnswerEvent;
  readonly isNewDomain: boolean;
  readonly modelScore?: number | null;
}): number {
  if (params.modelScore !== null && params.modelScore !== undefined) {
    return normalizeImportance(params.modelScore);
  }
  return ruleImportance(params.event, params.isNewDomain);
}

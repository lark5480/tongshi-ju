/**
 * NPC 引擎 · 事实层（语义记忆）
 *
 * 结构化事实 —— **每次都加载，不看主题**。
 *
 * 依据：工程综述指出语义检索会漏掉"每次都相关"的事实（玩家的名字、做过的承诺、
 * 与 NPC 的立场），故事实层是**必需的补充**而非可选项。
 *
 * 事实层的来源是**既有引擎的本地数据**（mastery / 错题本 / 历史统计）——
 * NPC 只读，不改引擎（裁决 5）。
 */

import type { DomainId } from "@/types";

import type { AnswerEvent, NpcFacts } from "../types";

/**
 * 事实层的构造参数 —— 全部来自既有引擎的产出。
 */
export interface BuildFactsParams {
  /** 既有引擎的掌握度映射（`domain|topic` → 熟练度）。 */
  readonly mastery: Readonly<Record<string, number>>;
  /** 既有引擎的答题统计（领域 → 累计答题次数）。 */
  readonly attemptCounts?: Readonly<Record<string, number>>;
  /** 既有引擎的错题本（领域 → 累计答错次数）。 */
  readonly wrongCounts?: Readonly<Record<string, number>>;
  /** 每个领域最近一次答题时刻。 */
  readonly lastSeenAt?: Readonly<Record<string, number>>;
  /** 玩家已触碰过的领域数。 */
  readonly touchedDomains?: number;
}

/**
 * 构造事实层。
 *
 * `mastery` 的键是 `domain|topic`（既有引擎的口径），而事实层按**领域**聚合 ——
 * 因为 NPC 的决策粒度是领域（选域权重是领域级的）。
 */
export function buildFacts(params: BuildFactsParams): NpcFacts {
  const mastery: Record<string, number> = {};
  for (const [key, value] of Object.entries(params.mastery ?? {})) {
    const domain = key.split("|")[0];
    if (!domain) continue;
    const prev = mastery[domain] ?? 0;
    // 同一领域多个知识点 → 取**平均**（不是最大）：一个领域里知识点越均衡，
    // 说明该领域整体越熟；取最大值会让"碰巧会一个冷门知识点"看起来很熟。
    const count = countTopicsFor(mastery, domain);
    mastery[domain] = count > 1 ? (prev + value) / count : value;
  }

  return {
    mastery,
    wrongCounts: { ...(params.wrongCounts ?? {}) },
    attemptCounts: { ...(params.attemptCounts ?? {}) },
    lastSeenAt: { ...(params.lastSeenAt ?? {}) },
    touchedDomains: params.touchedDomains ?? Object.keys(mastery).length,
  };
}

/**
 * 用一次答题事件更新事实层（返回新对象，不改原对象）。
 *
 * @param isNewDomain 该领域是否是首次触达（调用方用 attemptCounts 判定）
 */
export function updateFacts(facts: NpcFacts, event: AnswerEvent, isNewDomain: boolean): NpcFacts {
  const domain = event.domain;
  const attempts = (facts.attemptCounts[domain] ?? 0) + 1;
  const wrongs = (facts.wrongCounts[domain] ?? 0) + (event.correct ? 0 : 1);

  // 掌握度：答对小幅上升，答错小幅下降；下界 0，上界 1。
  //
  // ⚠️ **首次答题的域从 0.5 起算**，而不是 0：
  // 若从 0 起，答错 `0 - 0.15` 会被钳到 0 → "首次答错"这个最重要的信号被抹平
  // （该域看起来和"完全没碰过"一样）。从 0.5 起算则首次答错落到 0.35，
  // 与"全对但只答过 1 题"（0.6）区分得开。
  const prevMastery = facts.mastery[domain] ?? (attempts === 1 ? 0.5 : 0);
  const delta = event.correct ? 0.1 : -0.15;
  const mastery = Math.min(1, Math.max(0, prevMastery + delta));

  return {
    ...facts,
    mastery: { ...facts.mastery, [domain]: mastery },
    attemptCounts: { ...facts.attemptCounts, [domain]: attempts },
    wrongCounts: { ...facts.wrongCounts, [domain]: wrongs },
    lastSeenAt: { ...facts.lastSeenAt, [domain]: event.at },
    touchedDomains: isNewDomain ? facts.touchedDomains + 1 : facts.touchedDomains,
  };
}

/**
 * 某领域已掌握的知识点数（用于平均值聚合）。
 */
function countTopicsFor(mastery: Readonly<Record<string, number>>, domain: string): number {
  let n = 0;
  for (const key of Object.keys(mastery)) {
    if (key.split("|")[0] === domain) n += 1;
  }
  return n;
}

/**
 * 某领域是否**首次触达**（供 importance 规则打分用）。
 */
export function isNewDomain(facts: NpcFacts, domain: DomainId): boolean {
  return (facts.attemptCounts[domain] ?? 0) === 0;
}

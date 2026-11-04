/**
 * NPC 引擎 · 共享类型
 *
 * 「老师 NPC」的全部数据结构。**纯类型**，无运行时逻辑、无 IO。
 *
 * 设计约束（见 `docs/decisions/01-NPC立项裁决清单.md`）：
 * - 裁决 12：核心决策纯函数化 —— 本目录只描述形状，逻辑在 `lib/npc/core/`；
 * - 裁决 5：只读既有引擎 —— NPC 的输入是**既有引擎产出的数据**（mastery / 错题本 /
 *   答题历史），不反向依赖、不修改 `lib/engine/*`；
 * - 裁决 15：记忆按用户隔离 —— 所有带用户维度的结构都以 `userId` 为第一层键。
 */

import type { DomainId, Question } from "@/types";

/**
 * NPC 观察到的一次答题事件（情景记忆的原料）。
 *
 * 由既有引擎的结算数据派生，**不是**引擎新增的输出 ——
 * NPC 只读，不改引擎。
 */
export interface AnswerEvent {
  /** 题目 id（`Question.id`）。 */
  readonly questionId: string;
  /** 题目所属领域。 */
  readonly domain: DomainId;
  /** 题目知识点（`Question.topic`）。 */
  readonly topic: string;
  /** 题目难度（1-3）。 */
  readonly difficulty: number;
  /** 是否答对。 */
  readonly correct: boolean;
  /** 该题当时的连续答对次数（来自本局真实连击，见 `buildAnswerEvent`）。 */
  readonly streak: number;
  /**
   * 作答来源：`public` = 前 4 题（全网同题、计分）；`practice` = 第 5 题加练（不计分）。
   * 可选：旧事件没有该字段，读取方按 `public` 处理。
   */
  readonly source?: "public" | "practice";
  /** 事件发生时刻（毫秒时间戳；由调用方注入，引擎层不读时钟）。 */
  readonly at: number;
}

/**
 * 结构化事实（语义记忆层）—— **每次都加载，不看主题**。
 *
 * 依据：工程综述指出语义检索会漏掉"每次都相关"的事实（玩家名字、做过的承诺、
 * 与 NPC 的立场），故事实层是**必需的补充**而非可选项。
 */
export interface NpcFacts {
  /**
   * 每个领域的熟练度：**单知识点净答对数按域取平均**（0 起，满星 = 10 次净答对，
   * 与引擎 `masteryStars` 的满星线一致）。下游按 `MASTERY_FULL_MARKS` 归一为 0-1。
   */
  readonly mastery: Readonly<Record<string, number>>;
  /**
   * 每个知识点的熟练度：键为 `domain|topic`，值同样是**净答对数**（与 `mastery` 同口径）。
   *
   * 可选：旧数据 / 未注入该字段时，下游回落到该域的均值（`policy.topicMasteryMap`）。
   * 字段只随 `mastery` 一起增长，不改变既有域级契约。
   */
  readonly topicMastery?: Readonly<Record<string, number>>;
  /** 每个领域累计答错次数。 */
  readonly wrongCounts: Readonly<Record<string, number>>;
  /** 每个领域累计答题次数。 */
  readonly attemptCounts: Readonly<Record<string, number>>;
  /** 每个领域最近一次答题时刻。 */
  readonly lastSeenAt: Readonly<Record<string, number>>;
  /** 玩家已触碰过的领域数（用于"首次见到"判定）。 */
  readonly touchedDomains: number;
}

/**
 * 情景记忆条目 —— **只追加**，永不整体进 prompt。
 */
export interface NpcEpisode {
  readonly questionId: string;
  readonly domain: DomainId;
  readonly topic: string;
  readonly difficulty: number;
  readonly correct: boolean;
  /** 事件时刻。 */
  readonly at: number;
  /**
   * 重要度（1-10）。
   *
   * 有模型时由 LLM 打分；**降级路径**由规则打分（见 `core/importance.ts`）。
   * 两条路径落在**同一标度**，否则降级前后行为不可比（裁决 9）。
   */
  readonly importance: number;
  /** 最近一次被检索到的时刻（recency 衰减的基准）。 */
  readonly lastAccessedAt: number;
}

/**
 * 检索命中项及其评分明细（可解释 —— 报告里要能说清"为什么想起这条"）。
 */
export interface RetrievalHit {
  readonly episode: NpcEpisode;
  /** 合成总分（0-1）。 */
  readonly score: number;
  /** 近因性分量（0-1）。 */
  readonly recency: number;
  /** 重要度分量（0-1）。 */
  readonly importance: number;
  /** 相关性分量（0-1）。 */
  readonly relevance: number;
  /** 命中的原因（写进报告，供复盘）。 */
  readonly reason: string;
}

/**
 * NPC 的决策结果：选域 + 选题 + 点评。
 *
 * 裁决 4：NPC 是**难度调节器**，不是聊天机器人 ——
 * 它的输出必须影响玩法（选域 / 选题），而非陪聊。
 */
export interface NpcDecision {
  /** 推荐的领域排序（首位 = 最该练的）。 */
  readonly domainOrder: readonly DomainId[];
  /** 每个领域的推荐权重（0-1，越大越该练）。 */
  readonly weights: Readonly<Record<string, number>>;
  /** 在给定领域内推荐的题目 id 顺序（可为子集）。 */
  readonly questionOrder: readonly string[];
  /** 点评（降级时由模板生成）。 */
  readonly commentary: string;
  /** 本次决策是否走了降级路径。 */
  readonly degraded: boolean;
  /** 降级原因（`degraded` 为 true 时必填）。 */
  readonly degradedReason?: string;
  /** 决策依据摘要（写进报告，供复盘）。 */
  readonly rationale: string;
}

/**
 * NPC 决策的输入（**全部由调用方注入** —— 纯函数不读时钟、不读全局状态）。
 */
export interface NpcContext {
  /** 用户标识（记忆隔离用，裁决 15）。 */
  readonly userId: string;
  /** 当日领域集合（由既有引擎 `resolveDailyDomains` 产出 —— NPC 不改它）。 */
  readonly domains: readonly DomainId[];
  /** 候选题池（领域 → 该领域全部题目）。 */
  readonly pool: Partial<Record<DomainId, Question[]>>;
  /** 事实层。 */
  readonly facts: NpcFacts;
  /** 情景层（按时间倒序，最新在前）。 */
  readonly episodes: readonly NpcEpisode[];
  /** 种子（出题可复现，裁决 14）。 */
  readonly seed: number;
  /** 当前时刻（毫秒时间戳，由调用方注入）。 */
  readonly now: number;
}

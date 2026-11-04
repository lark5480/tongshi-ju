/**
 * NPC 引擎 · 纯函数核心
 *
 * 全部为**纯函数**：无 IO、无网络、不读时钟（时间由入参注入）、不读全局状态。
 * 依据：`lib/engine/` 的既有约定（AGENTS.md §2.4 依赖克制与确定性）。
 *
 * 模块：
 * - `importance.ts` —— 重要度打分（LLM 分 / 规则替身，同一 [1,10] 标度）
 * - `facts.ts`      —— 事实层构造与更新（只读既有引擎数据）
 * - `episodes.ts`   —— 情景层构造与追加
 * - `retrieve.ts`   —— 三段式检索（recency × importance × relevance）
 * - `policy.ts`     —— 选域权重与领域内选题排序（难度调节器的核心）
 * - `commentary.ts` —— 降级点评模板（LLM 不可用时的确定性底座）
 */

export { computeImportance, ruleImportance, normalizeImportance } from "./importance";
export { buildFacts, updateFacts } from "./facts";
export { toEpisode, appendEpisode, touchEpisode } from "./episodes";
export { retrieveEpisodes, DEFAULT_TOP_K, MIN_RELEVANCE } from "./retrieve";
export { computeDomainWeights, orderQuestions, decideNpc } from "./policy";
export { buildCommentary, pickWeakestDomain } from "./commentary";

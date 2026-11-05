/**
 * NPC 引擎 · 对外出口
 *
 * 「老师 NPC」的完整能力面。宿主（`app/`、服务端路由）只从这里取东西，
 * 不直接碰 `core/` 的内部结构 —— 这样内核可以自由重构而不影响宿主。
 *
 * 约束（权威源：`docs/NPC-ARCHITECTURE.md`）：
 * - 只读既有引擎，NPC 不改 `lib/engine/*`；
 * - 降级是一等公民 —— 没有模型端点也能跑；
 * - 核心决策纯函数化 —— 无 IO、不读时钟。
 */

export type {
  AnswerEvent,
  DecisionMemory,
  NpcContext,
  NpcDecision,
  NpcEpisode,
  NpcFacts,
  NpcPromise,
  RetrievalHit,
} from "./types";

export { narrate, narrateWeeklyReport, type NpcModel } from "./narrate";
export { buildFacts, updateFacts, isNewDomain } from "./core/facts";
export {
  appendEpisode,
  appendEpisodeCapped,
  buildAnswerEvent,
  toEpisode,
  touchEpisode,
} from "./core/episodes";
export { retrieveEpisodes } from "./core/retrieve";
export { selectMemories, formatMemoryReason, PLAYER_MEMORY_LIMIT } from "./core/memory";
export {
  buildBranchOptions,
  buildBranchTemplate,
  buildDailyPlan,
  buildPracticeReceipt,
  formatPromiseLine,
  normalizeDailyChoice,
  type BranchMeta,
  type BranchOption,
} from "./core/branch";
export { computeDomainWeights, decideNpc, orderQuestions, rankDomains } from "./core/policy";
export { pickPracticeQuestion, type PracticeFocus, type PracticePick } from "./core/practice";
export { buildCommentary, pickWeakestDomain, resolveCommentaryStatus } from "./core/commentary";
export { computeImportance, normalizeImportance, ruleImportance } from "./core/importance";

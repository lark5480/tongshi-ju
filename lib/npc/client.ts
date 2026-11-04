/**
 * NPC 引擎 · 客户端接入
 *
 * 把 NPC 接到每日挑战的流程里，**不修改 `lib/engine/*`**：
 * 1. 读既有存储 → 构造 NPC 上下文；
 * 2. 调 `/api/npc/coach` 拿点评（失败即降级，客户端另有模板兜底）；
 * 3. 答题后把事件写进 NPC 情景层。
 *
 * ## NPC 不改题集（重要）
 *
 * 每日挑战的题集必须**全网一致**（同日期 + 同领域集合 → 同一份题），
 * 否则红榜与同题 PK 都失去意义。因此 NPC 的作用点是**当日题目的先后**：
 * 把最该练的领域的题排到前面，而不是换掉哪些域、换掉哪些题 ——
 * 换域会破坏"全网同题"，换题会破坏"同一天不撞题"。
 *
 * NPC 的**领域顺序**用于当日题目的排序（`buildDailySet.domainOrder`）
 * 与点评（告诉玩家该练什么）；题集本身仍由既有引擎产出。
 */

"use client";

import type { DomainId, Question } from "@/types";

import { readJson, writeJson } from "@/lib/storage";

import { buildCommentary } from "./core/commentary";
import { decideNpc } from "./core/policy";
import { buildNpcContext, loadEpisodes, recordNpcEpisode, type StoredEpisode } from "./storage";
import type { AnswerEvent, NpcContext, NpcDecision, NpcEpisode, NpcFacts } from "./types";

/**
 * NPC 情景层的存储键。
 *
 * 用既有 `readJson` / `writeJson` 而非直接摸 `localStorage` ——
 * 它们带统一前缀，且在非持久环境（SSR / 隐私模式）下自动退回内存，
 * 与既有存储层的降级纪律一致。
 */
const STORAGE_KEY = "npc-episodes";

/** 读取 NPC 情景层。 */
function readStored(): StoredEpisode[] {
  return readJson<StoredEpisode[]>(STORAGE_KEY, []);
}

/** 写入 NPC 情景层。 */
function writeStored(episodes: StoredEpisode[]): void {
  writeJson(STORAGE_KEY, episodes);
}

/**
 * NPC 请求点评。
 *
 * **永不抛错**：网络失败 / 服务端降级 → 用本地模板点评，
 * 并显式标注 `degraded` 与原因（裁决 9）。
 */
export async function requestCoach(params: {
  readonly userId: string;
  readonly domains: readonly DomainId[];
  readonly facts: NpcFacts;
  readonly episodes: readonly NpcEpisode[];
  readonly seed: number;
  readonly now: number;
}): Promise<{
  readonly decision: NpcDecision;
  readonly degraded: boolean;
  readonly degradedReason?: string;
}> {
  const context: NpcContext = {
    userId: params.userId,
    domains: params.domains,
    pool: {},
    facts: params.facts,
    episodes: params.episodes,
    seed: params.seed,
    now: params.now,
  };

  try {
    const res = await fetch("/api/npc/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: params.userId,
        domains: params.domains,
        facts: params.facts,
        episodes: params.episodes,
        seed: params.seed,
        now: params.now,
      }),
    });

    if (!res.ok) {
      // 服务端不可用 / 未配置模型 → 本地模板兜底
      const reason = `点评服务不可用（HTTP ${res.status}）`;
      return {
        decision: decideNpc({
          context,
          commentary: buildCommentary(context),
          degraded: true,
          degradedReason: reason,
        }),
        degraded: true,
        degradedReason: reason,
      };
    }

    const data = (await res.json()) as {
      commentary?: string;
      degraded?: boolean;
      degradedReason?: string | null;
      rationale?: string;
      domainOrder?: DomainId[];
      weights?: Record<string, number>;
    };

    const commentary = typeof data.commentary === "string" ? data.commentary : "";
    const degraded = data.degraded === true;

    return {
      decision: {
        domainOrder: data.domainOrder ?? context.domains,
        weights: data.weights ?? {},
        questionOrder: [],
        commentary: commentary || buildCommentary(context),
        degraded,
        ...(data.degradedReason ? { degradedReason: data.degradedReason } : {}),
        rationale: data.rationale ?? "",
      },
      degraded,
      ...(data.degradedReason ? { degradedReason: data.degradedReason } : {}),
    };
  } catch (error) {
    const reason = `点评请求失败：${error instanceof Error ? error.message : String(error)}`;
    return {
      decision: decideNpc({
        context,
        commentary: buildCommentary(context),
        degraded: true,
        degradedReason: reason,
      }),
      degraded: true,
      degradedReason: reason,
    };
  }
}

/**
 * 记录一次作答到 NPC 情景层。
 *
 * 与既有 `recordAttempt` **并行**调用（不是替代）——
 * 既有引擎负责熟练度与错题本，NPC 只多存一份事件流。
 */
export function recordCoachEvent(params: {
  readonly userId: string;
  readonly event: AnswerEvent;
  readonly facts: NpcFacts;
}): void {
  try {
    recordNpcEpisode({
      write: writeStored,
      read: readStored,
      userId: params.userId,
      event: params.event,
      facts: params.facts,
    });
  } catch {
    // 情景层写入失败不影响主链路（见 writeStored 的说明）。
  }
}

/**
 * 读取当前用户的 NPC 情景层。
 */
export function loadCoachEpisodes(userId: string): NpcEpisode[] {
  return loadEpisodes(readStored, userId);
}

/**
 * 构造 NPC 上下文（客户端版，从既有存储取数）。
 */
export function buildCoachContext(params: {
  readonly userId: string;
  readonly domains: readonly DomainId[];
  readonly pool: Partial<Record<DomainId, Question[]>>;
  readonly mastery: Readonly<Record<string, number>>;
  readonly wrongEntries: readonly { domain: DomainId; wrongCount: number }[];
  readonly history: readonly { domains: readonly DomainId[]; correct: number; total: number }[];
  readonly seed: number;
  readonly now: number;
}) {
  return buildNpcContext({
    ...params,
    episodes: loadCoachEpisodes(params.userId),
  });
}

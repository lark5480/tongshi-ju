/**
 * NPC 引擎 · 客户端接入
 *
 * 把 NPC 接到每日挑战的流程里，**不修改 `lib/engine/*`**：
 * 1. 读既有存储 → 构造 NPC 上下文；
 * 2. 调 `/api/npc/coach` 拿点评（失败即降级，客户端另有模板兜底）；
 * 3. 答题后把事件写进 NPC 情景层。
 *
 * ## 4+1 分轨（重要）
 *
 * 每日挑战前 4 题必须**全网一致**（同日期 + 同领域集合 → 同一份题），
 * 否则红榜与同题 PK 都失去意义。**第 5 题是例外**：由 NPC 依据本人熟练度
 * 从题库另选（`pickPracticeQuestion`），不计分、不计排名，只写学习进度。
 *
 * 因此 NPC 的**领域顺序**用于**第 5 题的选题**与点评（告诉玩家该练什么）；
 * 前 4 题仍由既有引擎产出，NPC 不参与。
 */

"use client";

import type { DomainId, Question } from "@/types";

import { readJson, writeJson } from "@/lib/storage";

import { buildCommentary } from "./core/commentary";
import { isNewDomain } from "./core/facts";
import { decideNpc } from "./core/policy";
import {
  buildNpcContext,
  episodeId,
  loadEpisodes,
  recordNpcEpisode,
  updateEpisodeImportance,
  type StoredEpisode,
} from "./storage";
import type { AnswerEvent, NpcContext, NpcDecision, NpcEpisode, NpcFacts } from "./types";

/**
 * 上一次点评是否证明「模型可用」。
 *
 * 只看**服务端是否配置了 provider**，与这次点评是否降级无关：reasoning 模型
 * 可能偶发空正文导致点评降级，但重要度接口本身仍然可用。
 * 只有真的没配置模型时，才省掉为每题的重要度打分请求。
 */
let modelAvailable = false;

/**
 * provider 是否存在：`null` 表示还没拿到服务端结论（请求失败）。
 *
 * 仅用于区分降级原因 —— 配置了但调用失败 ≠ 没配置端点。
 */
let providerConfigured: boolean | null = null;

/**
 * 没有可用模型时的降级原因。
 *
 * 只有服务端明确返回 `provider: null` 才能说「未配置」；
 * 其余情况（请求失败 / 拿不到结论）都应写成调用不可用。
 */
function modelUnavailableReason(): string {
  return providerConfigured === false
    ? "未配置模型端点，重要度使用规则打分"
    : "点评模型调用失败，重要度先按规则分落盘";
}

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
 * 同步构造「模板先行」的点评（三态里的 `pending`）。
 *
 * 结算后立刻展示，避免面板空白等模型；模型回来后由调用方覆盖为
 * `model` / `degraded` 的最终结果。模板基于**最新事实**生成，
 * 因此统计（答 N 错 M、熟练度）与结算后的本地数据一致。
 */
export function buildPendingDecision(context: NpcContext): NpcDecision {
  return decideNpc({
    context,
    commentary: buildCommentary(context),
    commentaryStatus: "pending",
  });
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
      // 服务端不可用 → 本地模板兜底。
      // 注意：这里**不重置** modelAvailable —— HTTP 失败拿不到 provider 结论，
      // 不能据此判定「没有配置模型」。
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
      /** 服务端实际使用的 provider 名；null 表示未配置模型。 */
      provider?: string | null;
    };

    const commentary = typeof data.commentary === "string" ? data.commentary : "";
    const degraded = data.degraded === true;
    // 只看 provider 是否存在：点评降级（如 reasoning 模型偶发空正文）
    // 不代表重要度接口不可用。
    providerConfigured = typeof data.provider === "string" && data.provider.length > 0;
    modelAvailable = providerConfigured;

    return {
      decision: {
        domainOrder: data.domainOrder ?? context.domains,
        weights: data.weights ?? {},
        questionOrder: [],
        commentary: commentary || buildCommentary(context),
        degraded,
        // 三态：请求成功且未降级 = 模型台词；否则 = 真失败。
        commentaryStatus: degraded ? "degraded" : "model",
        ...(data.degradedReason ? { degradedReason: data.degradedReason } : {}),
        rationale: data.rationale ?? "",
      },
      degraded,
      ...(data.degradedReason ? { degradedReason: data.degradedReason } : {}),
    };
  } catch (error) {
    // 网络失败同样拿不到 provider 结论：保持上一次已知状态（未知就保持未知）。
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
 * 请求模型给一次答题事件打重要度（**永不抛错**）。
 *
 * 模型不可用 / 请求失败 → 返回 `importance: null` + 降级原因，
 * 调用方据此保持规则分，并把降级原因写进情景条目（不静默降级）。
 */
async function requestImportanceScore(params: {
  readonly event: AnswerEvent;
  readonly isNewDomain: boolean;
}): Promise<{ importance: number | null; degradedReason?: string }> {
  if (!modelAvailable) {
    return {
      importance: null,
      degradedReason: modelUnavailableReason(),
    };
  }
  try {
    const res = await fetch("/api/npc/importance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: params.event, isNewDomain: params.isNewDomain }),
    });
    if (!res.ok) {
      return { importance: null, degradedReason: `重要度服务不可用（HTTP ${res.status}）` };
    }
    const data = (await res.json()) as {
      importance?: number | null;
      degraded?: boolean;
      degradedReason?: string | null;
    };
    if (typeof data.importance === "number" && Number.isFinite(data.importance)) {
      return { importance: data.importance };
    }
    return {
      importance: null,
      degradedReason: data.degradedReason ?? "重要度服务未返回可用分数",
    };
  } catch (error) {
    return {
      importance: null,
      degradedReason: `重要度请求失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 记录一次作答到 NPC 情景层。
 *
 * 与既有 `recordAttempt` **并行**调用（不是替代）——
 * 既有引擎负责熟练度与错题本，NPC 只多存一份事件流。
 */
export async function recordCoachEvent(params: {
  readonly userId: string;
  readonly event: AnswerEvent;
  readonly facts: NpcFacts;
}): Promise<void> {
  try {
    const isNew = isNewDomain(params.facts, params.event.domain);

    // ---- 1) 先同步落盘：规则分是保底值 ----
    //
    // 模型打分是异步的，而用户可能答完就关页。如果等模型回来再写，
    // 这次事件就会凭空消失。所以先用规则分写一条，保证"至少记住"。
    const stored = recordNpcEpisode({
      write: writeStored,
      read: readStored,
      userId: params.userId,
      event: params.event,
      facts: params.facts,
      importance: null,
      importanceDegradedReason: modelAvailable
        ? "模型重要度尚未返回，先按规则分落盘"
        : modelUnavailableReason(),
    });

    // 模型不可用（未配置 / 请求失败）：规则分就是最终结果，不再发注定降级的请求。
    if (!modelAvailable) return;

    // ---- 2) 模型返回后就地升级；失败则保持规则分、只更新降级原因 ----
    const scored = await requestImportanceScore({ event: params.event, isNewDomain: isNew });
    updateEpisodeImportance({
      write: writeStored,
      read: readStored,
      userId: params.userId,
      id: episodeId(stored),
      modelImportance: scored.importance,
      ...(scored.degradedReason ? { degradedReason: scored.degradedReason } : {}),
    });
    // 若返回 null（条目已被容量上限淘汰）→ 不重建，避免复活过期记忆。
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

/**
 * NPC 引擎 · LLM 台词层
 *
 * 裁决 13：LLM 只在两处介入 —— ① 意图分类 ② 台词生成。
 * 本文件负责第 ② 处（台词）；第 ① 处（意图分类）暂不实现 ——
 * 通识局当前没有"玩家自由输入"的入口（裁决 4：NPC 不是聊天机器人）。
 *
 * **降级契约（裁决 9）**：模型不可用 / 超时 / 返回非法 → 一律降级到
 * `commentary.ts` 的确定性模板，**不抛错、不阻塞主链路**。
 *
 * 密钥纪律：API Key 只从服务端环境变量读取，绝不进入浏览器 bundle
 * （沿用 `lib/ai/provider.ts` 的约定 —— 本模块只会被服务端路由 import）。
 */

import { domainName } from "@/content/domains";
import { formatPromiseLine } from "./core/branch";
import { buildCommentary, pickWeakestDomain } from "./core/commentary";
import { selectMemories } from "./core/memory";
import { buildWeeklyTemplate, type WeeklyDigest } from "./core/weekly";
import type { DecisionMemory, NpcContext, NpcDecision } from "./types";
import { decideNpc, MASTERY_FULL_MARKS } from "./core/policy";

/** 一次生成的结果：正文是否为空 + 结束原因（供「思维链耗尽」判定重试）。 */
interface NpcGeneration {
  readonly value: unknown;
  readonly finishReason: string | null;
  readonly contentEmpty: boolean;
  readonly maxTokens: number;
}

/** NPC 的 LLM 依赖（与 `lib/ai/provider.ts` 的 `AiProvider` 同构，独立实现避免耦合）。 */
export interface NpcModel {
  readonly name: string;
  /** 请求模型返回 JSON；失败时抛错，由调用方降级。 */
  generate(prompt: string, opts?: { maxTokens?: number }): Promise<unknown>;
  /** 带元信息的生成；正文为空不抛错，便于按 `finish_reason` 决定重试。 */
  generateWithMeta?(
    prompt: string,
    opts?: { maxTokens?: number }
  ): Promise<{
    readonly value: unknown;
    readonly meta: {
      readonly finishReason: string | null;
      readonly contentEmpty: boolean;
      readonly maxTokens: number;
    };
  }>;
}

/** 点评的基础额度；不足时按倍数追加，不在调用处散落魔法数字。 */
const COMMENTARY_BASE_TOKENS = 800;

/** 周报短一段话，额度比点评小。 */
const WEEKLY_BASE_TOKENS = 400;

/**
 * 让 NPC 说话（**永不抛错**）。
 *
 * @param model 模型客户端；`null` 表示未配置 → 直接走模板
 */
export async function narrate(params: {
  readonly context: NpcContext;
  readonly model: NpcModel | null;
  readonly timeoutMs?: number;
}): Promise<{
  readonly decision: NpcDecision;
  readonly degraded: boolean;
  readonly degradedReason?: string;
}> {
  const { context, model } = params;
  // reasoning 模型的思维链会显著拉长首字时间（实测 10–45s，偶发更久）。
  // 单次额度与 provider 的 60s 截止对齐；重试时两次各自计时。
  const timeoutMs = params.timeoutMs ?? 60_000;

  // 记忆只算一次：同一份同时喂 prompt 与决策，面板展示的不会和模型看到的分叉。
  // 无模型 / 调用失败时也保留 —— 记忆来自本地事实，不依赖模型。
  const memories = resolveMemories(context);

  // 无模型 → 直接降级
  if (!model) {
    return {
      decision: decideNpc({
        context,
        commentary: buildCommentary(context),
        degraded: true,
        degradedReason: "未配置模型端点（AI_API_BASE / AI_API_KEY / AI_MODEL 缺失）",
        memories,
      }),
      degraded: true,
      degradedReason: "未配置模型端点（AI_API_BASE / AI_API_KEY / AI_MODEL 缺失）",
    };
  }

  try {
    const prompt = buildPrompt(context, memories);
    const generated = await generateText({
      model,
      prompt,
      timeoutMs,
      baseTokens: COMMENTARY_BASE_TOKENS,
    });
    if (!generated.text) {
      throw new Error(generated.failureReason ?? "模型返回内容为空或不是可提取的文本");
    }
    return {
      decision: decideNpc({
        context,
        commentary: withPromiseMention(generated.text, context.promise),
        degraded: false,
        memories,
      }),
      degraded: false,
    };
  } catch (error) {
    const reason = `模型调用失败：${error instanceof Error ? error.message : String(error)}`;
    return {
      decision: decideNpc({
        context,
        commentary: buildCommentary(context),
        degraded: true,
        degradedReason: reason,
        memories,
      }),
      degraded: true,
      degradedReason: reason,
    };
  }
}

/** 焦点域下的玩家可见记忆；没有焦点域时为空。 */
function resolveMemories(context: NpcContext): DecisionMemory[] {
  const focus = pickWeakestDomain(context);
  if (!focus) return [];
  return selectMemories({
    episodes: context.episodes,
    domain: focus,
    now: context.now,
  });
}

/**
 * 模型有时会忽略“上次的选择”。
 *
 * 次日记忆是产品承诺，不能靠采样碰运气：模型没提时补半句，
 * 保证玩家一定能看到这次选择被记住。
 */
function withPromiseMention(text: string, promise?: NpcContext["promise"]): string {
  if (!promise) return text;
  if (text.includes("上次") || text.includes(promise.label)) return text;
  const punct = /[。！？]$/.test(text) ? "" : "。";
  return `${text}${punct}上次你选了${promise.label}，今天先看它。`;
}

/**
 * 构造提示词。
 *
 * 只给模型**事实摘要**，不让它决定出题 —— 裁决 14。
 */
function buildPrompt(context: NpcContext, memories: readonly DecisionMemory[]): string {
  const domainLines = context.domains.map((d) => {
    const attempts = context.facts.attemptCounts[d] ?? 0;
    const wrongs = context.facts.wrongCounts[d] ?? 0;
    const mastery = Math.round(context.facts.mastery[d] ?? 0);
    // 玩家可见口径：中文域名 + 「熟练度 N/10」（与 `policy.ts` 的 rationale 一致）。
    return `- ${domainName(d)}：熟练度 ${mastery}/${MASTERY_FULL_MARKS}，答题 ${attempts} 次，错 ${wrongs} 次`;
  });

  const weak = context.domains
    .slice()
    .sort((a, b) => (context.facts.wrongCounts[b] ?? 0) - (context.facts.wrongCounts[a] ?? 0))
    .slice(0, 2)
    .map(domainName);

  return [
    "你是一个知识闯关游戏里的「老师 NPC」。",
    "请根据玩家的答题情况，用**一句话**点评他今天该练什么。",
    "要求：中文、不超过 50 字、必须写出至少一个数字（答题次数或错题次数）、点名领域、不要寒暄、不要提问。",
    "",
    "玩家在各领域的情况：",
    ...domainLines,
    "",
    `最薄弱的两个领域：${weak.join("、") || "无"}`,
    ...(context.promise
      ? [
          "",
          `玩家${formatPromiseLine(context.promise)}（${context.promise.date}）。`,
          "请用半句话自然呼应这次选择（例如“上次你选了…，今天先…”），不要逐字复述。",
        ]
      : []),
    ...(memories.length > 0
      ? [
          "",
          "你记得这些事（最多提一条，可以自然带出，不要逐条复述，也不要编造）：",
          ...memories.map((m) => `- ${m.reason}`),
        ]
      : []),
    "",
    "只输出这句话本身，不要任何解释或格式标记。",
  ].join("\n");
}

/**
 * 跑一次生成。
 *
 * 没有元信息能力的模型退回 `generate` —— 此时拿不到 `finish_reason`，
 * 只按「正文为空」判定，不做额度重试。
 */
async function generateOnce(
  model: NpcModel,
  prompt: string,
  maxTokens: number
): Promise<NpcGeneration> {
  if (model.generateWithMeta) {
    const { value, meta } = await model.generateWithMeta(prompt, { maxTokens });
    return {
      value,
      finishReason: meta.finishReason,
      contentEmpty: meta.contentEmpty,
      maxTokens: meta.maxTokens,
    };
  }
  const value = await model.generate(prompt, { maxTokens });
  return {
    value,
    finishReason: null,
    contentEmpty: value === null || value === undefined,
    maxTokens,
  };
}

/**
 * 生成一段文本，失败返回原因（不抛错）。
 *
 * 点评与周报共用同一套超时 / 思维链重试逻辑，避免两处各写一份。
 */
async function generateText(params: {
  readonly model: NpcModel;
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly baseTokens: number;
}): Promise<{ text: string | null; failureReason: string | null }> {
  let attempt = await withTimeout(
    generateOnce(params.model, params.prompt, params.baseTokens),
    params.timeoutMs
  );
  let text = extractText(attempt.value);

  // reasoning 模型的思维链也算 max_tokens：正文为空且 finish_reason=length
  // 说明额度被思维链吃光 → 按倍数追加额度重试一次。
  if (!text && attempt.finishReason === "length") {
    attempt = await withTimeout(
      generateOnce(params.model, params.prompt, attempt.maxTokens * 2),
      params.timeoutMs
    );
    text = extractText(attempt.value);
  }

  if (text) return { text, failureReason: null };
  return {
    text: null,
    failureReason:
      attempt.finishReason === "length"
        ? `思维链耗尽：finish_reason=length（max_tokens=${attempt.maxTokens}）`
        : "模型返回内容为空或不是可提取的文本",
  };
}

/**
 * 从模型返回里提取文本（容忍 JSON 包裹与 markdown 代码块）。
 */
function extractText(raw: unknown): string | null {
  if (typeof raw === "string") return strip(raw);
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // `reply` 是 LongCat 等模型在「一句话」要求下的常见键名；放在末尾，
    // 不改变既有候选的优先级。
    for (const key of ["commentary", "text", "message", "content", "reply"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return strip(v);
    }
    if (typeof obj["choices"] === "object" && Array.isArray(obj["choices"])) {
      const first = (obj["choices"] as unknown[])[0] as
        { message?: { content?: string } } | undefined;
      const content = first?.message?.content;
      if (typeof content === "string" && content.trim()) return strip(content);
    }
    // 模型对「一句话」的键名并不稳定（实测见过 reply / comment / 点评）。
    // 已知键都不命中时，取第一个非空字符串值兜底；仍为空则返回 null 走降级。
    for (const value of Object.values(obj)) {
      if (typeof value === "string" && value.trim()) return strip(value);
    }
  }
  return null;
}

/** 去掉包裹的引号与代码块标记。 */
function strip(text: string): string {
  let out = text.trim();
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(out);
  if (fenced) out = fenced[1]!.trim();
  out = out.replace(/^["'`]|["'`]$/g, "").trim();
  return out;
}

/**
 * 超时保护（模型卡住时不拖垮主链路）。
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`模型调用超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 本周周报（**永不抛错**）。
 *
 * 与点评共用 `generateText` 的超时 / 重试；无模型或失败时返回确定性模板，
 * 并显式给出降级原因（不可静默降级）。
 */
export async function narrateWeeklyReport(params: {
  readonly digest: WeeklyDigest;
  readonly model: NpcModel | null;
  readonly timeoutMs?: number;
}): Promise<{ text: string; degraded: boolean; degradedReason?: string }> {
  const template = buildWeeklyTemplate(params.digest);
  if (!params.model) {
    return {
      text: template,
      degraded: true,
      degradedReason: "未配置模型端点（AI_API_BASE / AI_API_KEY / AI_MODEL 缺失）",
    };
  }

  try {
    const generated = await generateText({
      model: params.model,
      prompt: buildWeeklyPrompt(params.digest),
      timeoutMs: params.timeoutMs ?? 60_000,
      baseTokens: WEEKLY_BASE_TOKENS,
    });
    if (!generated.text) {
      throw new Error(generated.failureReason ?? "模型返回内容为空或不是可提取的文本");
    }
    return { text: generated.text, degraded: false };
  } catch (error) {
    return {
      text: template,
      degraded: true,
      degradedReason: `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 周报提示词：只给聚合事实，不让模型碰出题或计分。 */
function buildWeeklyPrompt(digest: WeeklyDigest): string {
  const weak = digest.weakestDomain
    ? digest.domains.find((d) => d.domain === digest.weakestDomain)
    : undefined;
  const lines = [
    "你是知识闯关游戏里的「老师 NPC」。下面是你负责的玩家本周的记录：",
    `- 每日挑战 ${digest.sessions} 次（活跃 ${digest.activeDays} 天），答对 ${digest.correct}/${digest.answered} 题（${Math.round(
      digest.accuracy * 100
    )}%）`,
    weak && weak.wrongs > 0
      ? `- 最薄弱的领域：${domainName(weak.domain)}（错 ${weak.wrongs} 次）`
      : "- 本周没有答错",
    ...(digest.practice.shown > 0
      ? [`- 加练题：作答 ${digest.practice.answered} 天，跳过 ${digest.practice.skipped} 天`]
      : []),
  ];

  return [
    ...lines,
    "",
    "请写一段不超过 80 字的中文周报：先肯定一个具体进步，再给一个下周可执行的建议。",
    "不要寒暄、不要提问、不要编造未提供的数据。",
    "只输出这段话本身，不要任何解释或格式标记。",
  ].join("\n");
}

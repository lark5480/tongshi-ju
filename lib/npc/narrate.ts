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
import { buildCommentary } from "./core/commentary";
import type { NpcContext, NpcDecision } from "./types";
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

  // 无模型 → 直接降级
  if (!model) {
    return {
      decision: decideNpc({
        context,
        commentary: buildCommentary(context),
        degraded: true,
        degradedReason: "未配置模型端点（AI_API_BASE / AI_API_KEY / AI_MODEL 缺失）",
      }),
      degraded: true,
      degradedReason: "未配置模型端点（AI_API_BASE / AI_API_KEY / AI_MODEL 缺失）",
    };
  }

  try {
    const prompt = buildPrompt(context);
    const first = await withTimeout(generateOnce(model, prompt, COMMENTARY_BASE_TOKENS), timeoutMs);
    let attempt = first;
    let text = extractText(attempt.value);

    // reasoning 模型的思维链也算 max_tokens：正文为空且 finish_reason=length
    // 说明额度被思维链吃光 → 按倍数追加额度重试一次。
    if (!text && attempt.finishReason === "length") {
      attempt = await withTimeout(generateOnce(model, prompt, attempt.maxTokens * 2), timeoutMs);
      text = extractText(attempt.value);
    }

    if (!text) {
      throw new Error(
        attempt.finishReason === "length"
          ? `思维链耗尽：finish_reason=length（max_tokens=${attempt.maxTokens}）`
          : "模型返回内容为空或不是可提取的文本"
      );
    }
    return {
      decision: decideNpc({ context, commentary: text, degraded: false }),
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
      }),
      degraded: true,
      degradedReason: reason,
    };
  }
}

/**
 * 构造提示词。
 *
 * 只给模型**事实摘要**，不让它决定出题 —— 裁决 14。
 */
function buildPrompt(context: NpcContext): string {
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
    "要求：中文、不超过 40 字、具体点名领域与数字、不要寒暄、不要提问。",
    "",
    "玩家在各领域的情况：",
    ...domainLines,
    "",
    `最薄弱的两个领域：${weak.join("、") || "无"}`,
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

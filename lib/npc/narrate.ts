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

/** NPC 的 LLM 依赖（与 `lib/ai/provider.ts` 的 `AiProvider` 同构，独立实现避免耦合）。 */
export interface NpcModel {
  readonly name: string;
  /** 请求模型返回 JSON；失败时抛错，由调用方降级。 */
  generate(prompt: string, opts?: { maxTokens?: number }): Promise<unknown>;
}

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
  const timeoutMs = params.timeoutMs ?? 15_000;

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
    const commentary = await withTimeout(
      model.generate(buildPrompt(context), { maxTokens: 200 }),
      timeoutMs
    );
    const text = extractText(commentary);
    if (!text) {
      throw new Error("模型返回内容为空或不是可提取的文本");
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
 * 从模型返回里提取文本（容忍 JSON 包裹与 markdown 代码块）。
 */
function extractText(raw: unknown): string | null {
  if (typeof raw === "string") return strip(raw);
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["commentary", "text", "message", "content"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return strip(v);
    }
    if (typeof obj["choices"] === "object" && Array.isArray(obj["choices"])) {
      const first = (obj["choices"] as unknown[])[0] as
        { message?: { content?: string } } | undefined;
      const content = first?.message?.content;
      if (typeof content === "string" && content.trim()) return strip(content);
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

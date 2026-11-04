/**
 * POST /api/npc/coach —— 老师 NPC 的点评生成。
 *
 * ## 边界（对齐既有 AI 路由的纪律）
 *
 * - **未配置 provider 时返回 503 + `degraded: true` 的降级点评**，
 *   主链路（每日挑战）完全不受影响 —— 客户端拿到的是模板点评，不是错误；
 * - 模型调用失败**不抛错**，同样降级；
 * - **密钥只从服务端环境变量读取**，绝不进浏览器 bundle；
 * - 限流按 IP，与既有 AI 出题接口同一套机制。
 *
 * ## 为什么要有这个路由
 *
 * NPC 的**决策逻辑是纯函数、跑在客户端**（`lib/npc/core/`）；
 * 只有**台词生成**需要模型，而模型端点必须在服务端 —— 浏览器带 Key 是红线。
 * 这个路由只负责"把事实摘要交给模型，换回一句点评"。
 */

import { fail, ok, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { getProvider } from "@/lib/ai/provider";
import { z } from "zod";

import { buildCommentary, pickWeakestDomain } from "@/lib/npc/core/commentary";
import { narrate } from "@/lib/npc";
import type { NpcContext } from "@/lib/npc/types";

export const dynamic = "force-dynamic";

/** 请求体：NPC 决策所需的**事实摘要**（不含题池 —— 服务端不需要全量题目）。 */
const npcCoachSchema = z.object({
  userId: z.string().min(1).max(64),
  domains: z.array(z.string().min(1).max(32)).min(1).max(12),
  facts: z.object({
    mastery: z.record(z.string(), z.number()),
    topicMastery: z.record(z.string(), z.number()).optional(),
    wrongCounts: z.record(z.string(), z.number()),
    attemptCounts: z.record(z.string(), z.number()),
    lastSeenAt: z.record(z.string(), z.number()),
    touchedDomains: z.number().int().min(0),
  }),
  episodes: z
    .array(
      z.object({
        questionId: z.string().min(1),
        domain: z.string().min(1),
        topic: z.string(),
        difficulty: z.number().int().min(1).max(3),
        correct: z.boolean(),
        at: z.number(),
        importance: z.number().min(1).max(10),
        lastAccessedAt: z.number(),
      })
    )
    .max(200)
    .default([]),
  seed: z.number().int(),
  now: z.number().int(),
});

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, "npc-coach", 20);
  if (limited) return limited;

  const parsed = npcCoachSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }
  const input = parsed.data;

  // 题池在服务端不参与点评（台词只需要事实摘要），故传空池。
  const context: NpcContext = {
    userId: input.userId,
    domains: input.domains as NpcContext["domains"],
    pool: {},
    facts: input.facts,
    episodes: input.episodes as NpcContext["episodes"],
    seed: input.seed,
    now: input.now,
  };

  const provider = getProvider();
  const result = await narrate({
    context,
    model: provider ? { name: provider.name, generate: provider.generate.bind(provider) } : null,
  });

  // 治理证据：即使降级也要返回可查的字段（裁决：N4 每次对话有治理证据）。
  return ok({
    commentary: result.decision.commentary,
    degraded: result.degraded,
    degradedReason: result.degradedReason ?? null,
    rationale: result.decision.rationale,
    domainOrder: result.decision.domainOrder,
    weights: result.decision.weights,
    weakestDomain: pickWeakestDomain(context) ?? null,
    /** 模板点评（降级时的底稿，便于对照模型版本改了没有）。 */
    templateCommentary: buildCommentary(context),
    provider: provider?.name ?? null,
  });
}

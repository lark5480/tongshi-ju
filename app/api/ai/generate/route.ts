import { ok, fail, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/store";
import { aiGenerateSchema } from "@/content/domains/schema";
import { getProvider } from "@/lib/ai/provider";
import { generateBatch, GenerateInputError } from "@/lib/ai/generate";
import { writePendingBatch } from "@/lib/ai/pending-io";
import type { PendingBatch } from "@/lib/ai/pending";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/ai/generate —— AI 出题（管理入口）。
 *
 * ## 边界
 *
 * - **未配置 provider 时直接返回 503**，主链路（每日挑战 / 对战）完全不受影响；
 * - 通过 10 步校验链的题目**只进待审池**，不直接进入正式题库；
 * - AI 题**永不参与每日挑战 / duel**（见 `docs/CONTENT.md` §8 与 AGENTS.md §2.1）。
 *
 * ## 落盘
 *
 * 待审池写入 `.ai-pending/<batchId>.json`（本地目录，已 gitignore）。
 * Serverless 等只读环境写盘失败时**不返回 500**：生成结果仍可用，
 * 但响应里显式给出 `pendingPersisted: false` 与原因。
 *
 * ## 鉴权
 *
 * 设置 `AI_ADMIN_TOKEN` 时校验该令牌；未设置时仅在 `NODE_ENV=development` 下允许调用。
 */
export async function POST(req: Request) {
  const limited = rateLimitGuard(req, "ai-generate", RATE_LIMITS.aiGenerate);
  if (limited) return limited;

  // ---- 鉴权 ----
  const token = process.env.AI_ADMIN_TOKEN;
  if (token) {
    const provided = req.headers.get("x-ai-admin-token") ?? "";
    if (provided !== token) return fail("无权调用该接口", 401, "unauthorized");
  } else if (process.env.NODE_ENV !== "development") {
    return fail("AI 接口未启用", 503, "ai_disabled");
  }

  // ---- provider ----
  const provider = getProvider();
  if (!provider) {
    return fail("AI 出题未启用（缺少 AI_API_BASE / AI_API_KEY / AI_MODEL）", 503, "ai_disabled");
  }

  // ---- 入参 ----
  const parsed = aiGenerateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }
  const input = parsed.data;

  // ---- 生成 + 校验链 ----
  let result: Awaited<ReturnType<typeof generateBatch>>;
  try {
    result = await generateBatch(input, provider);
  } catch (e) {
    if (e instanceof GenerateInputError) {
      return fail(e.message, 400, "invalid_input");
    }
    console.error("[ai] 生成失败：", e);
    return fail("AI 生成失败，已降级为题库题", 502, "ai_failed");
  }

  const batch: PendingBatch = {
    version: 1,
    batchId: result.batchId,
    domain: result.domain,
    createdAt: new Date().toISOString(),
    provider: provider.name,
    ...(process.env.AI_MODEL ? { model: process.env.AI_MODEL } : {}),
    input: {
      domain: input.domain,
      ...(input.topic ? { topic: input.topic } : {}),
      ...(input.difficulty ? { difficulty: input.difficulty } : {}),
      count: input.count,
      ...(input.variantOf ? { variantOf: input.variantOf.questionId } : {}),
    },
    accepted: result.accepted,
    rejected: result.rejected,
    status: "pending",
  };

  let pendingPersisted = true;
  let pendingError: string | null = null;
  try {
    await writePendingBatch(batch);
  } catch (e) {
    pendingPersisted = false;
    pendingError = e instanceof Error ? e.message : String(e);
    console.error("[ai] 待审池落盘失败：", pendingError);
  }

  return ok({
    batchId: result.batchId,
    domain: result.domain,
    accepted: result.accepted,
    rejected: result.rejected,
    /** 待审池：这些题尚未进入正式题库，需人工审核后转入 content/ai/。 */
    status: "pending",
    pendingPersisted,
    pendingError,
  });
}

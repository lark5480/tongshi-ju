import { ok, fail, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/store";
import { aiGenerateSchema } from "@/content/domains/schema";
import { DOMAINS } from "@/content/domains";
import { getProvider } from "@/lib/ai/provider";
import { buildGeneratePrompt, buildVariantPrompt } from "@/lib/ai/prompt";
import { validateAiBatch } from "@/lib/ai/validate";
import { addToIndex, type DomainTokenIndex } from "@/lib/ai/dedupe";
import { allFingerprints, domainBank } from "@/lib/content/server-bank";
import { fingerprintOf, normalizeStem, tokenize } from "@/lib/content/fingerprint";
import { nanoid } from "nanoid";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/generate —— AI 出题（管理入口）。
 *
 * ## 边界
 *
 * - **未配置 provider 时直接返回 503**，主链路（每日挑战 / 对战）完全不受影响；
 * - 通过 10 步校验链的题目**只进待审池**，不直接进入正式题库；
 * - AI 题**永不参与每日挑战**（每日挑战必须可复现、可排行）。
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
  const meta = DOMAINS.find((d) => d.id === input.domain);
  if (!meta) return fail("未知领域", 400, "invalid_input");

  // ---- prompt ----
  const prompt = input.variantOf
    ? buildVariantPrompt({
        domain: input.domain,
        domainName: meta.name,
        topic: input.variantOf.questionId,
        originalStem: input.variantOf.stem,
        originalAnswer: input.variantOf.answer,
        count: input.count,
      })
    : buildGeneratePrompt({
        domain: input.domain,
        domainName: meta.name,
        topics: meta.topics,
        topic: input.topic,
        difficulty: input.difficulty,
        count: input.count,
      });

  // ---- 调用 ----
  let raw: unknown;
  try {
    raw = await provider.generate(prompt);
  } catch (e) {
    // 失败**不抛出**：由调用方降级到 seed 题库
    console.error("[ai] 生成失败：", e);
    return fail("AI 生成失败，已降级为题库题", 502, "ai_failed");
  }

  // ---- 校验链 ----
  const knownFingerprints = new Map<string, string>();
  for (const q of domainBank(input.domain)) knownFingerprints.set(q.fingerprint, q.id);
  for (const fp of allFingerprints()) {
    if (!knownFingerprints.has(fp)) knownFingerprints.set(fp, fp);
  }

  const tokenIndex: DomainTokenIndex = new Map();
  for (const q of domainBank(input.domain)) {
    tokenIndex.set(q.domain, [
      ...(tokenIndex.get(q.domain) ?? []),
      { id: q.id, tokens: tokenize(normalizeStem(q.stem)) },
    ]);
  }

  const batchId = `ai-${Date.now().toString(36)}-${nanoid(6)}`;
  const result = validateAiBatch(raw, {
    domain: input.domain,
    knownFingerprints,
    tokenIndex,
    batchId,
    variantOf: input.variantOf?.questionId,
    makeId: (domain, stem) => {
      const fp = fingerprintOf(stem);
      return `${domain}-ai-${fp}`;
    },
  });

  for (const q of result.accepted) addToIndex(tokenIndex, q);

  return ok({
    batchId,
    domain: input.domain,
    accepted: result.accepted,
    rejected: result.rejected,
    /** 待审池：这些题尚未进入正式题库，需人工抽检后转入。 */
    status: "pending",
  });
}

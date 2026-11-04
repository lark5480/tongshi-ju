/**
 * POST /api/npc/importance —— 用模型给一次答题事件打重要度（1-10）。
 *
 * ## 边界
 *
 * - **未配置 provider 时返回 200 + `degraded: true`**（`importance: null`），
 *   客户端保持规则分并把它标进情景条目 —— 降级不能静默；
 * - 模型失败 / 超时 / 返回不可解析 → 同上（200，不抛 5xx，主链路不阻塞）；
 * - **密钥只从服务端环境变量读取**（复用 `lib/ai/provider.ts`）；
 * - 限流按 IP，与 `/api/npc/coach` 同一套机制。
 *
 * ## 为什么单独一条路由
 *
 * 重要度是**每答一题**都要打的（情景层逐条落盘），而点评是**每局一次**。
 * 合成一条路由会让点评请求携带大量无关的事件字段；拆开后职责清晰，
 * 且客户端在无模型时可以直接跳过（避免无意义的网络请求）。
 */

import { z } from "zod";

import { getProvider } from "@/lib/ai/provider";
import { ok, readJson, fail } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { extractImportanceFromModel } from "@/lib/npc/core/importance";

export const dynamic = "force-dynamic";

const importanceSchema = z.object({
  event: z.object({
    questionId: z.string().min(1),
    domain: z.string().min(1),
    topic: z.string(),
    difficulty: z.number().int().min(1).max(3),
    correct: z.boolean(),
    streak: z.number().int().min(0),
    source: z.enum(["public", "practice"]).optional(),
    at: z.number().int(),
  }),
  isNewDomain: z.boolean(),
});

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, "npc-importance", 120);
  if (limited) return limited;

  const parsed = importanceSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }
  const input = parsed.data;

  const provider = getProvider();
  if (!provider) {
    return ok({
      importance: null,
      degraded: true,
      degradedReason: "未配置模型端点（AI_API_BASE / AI_API_KEY / AI_MODEL 缺失）",
    });
  }

  try {
    const raw = await provider.generate(buildPrompt(input), { maxTokens: 60 });
    const importance = extractImportanceFromModel(raw);
    if (importance === null) {
      throw new Error("模型返回内容不含可解析的重要度");
    }
    return ok({ importance, degraded: false, degradedReason: null });
  } catch (error) {
    return ok({
      importance: null,
      degraded: true,
      degradedReason: `模型重要度打分失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/** 只给模型事件摘要 —— 不让它决定出题，也不让它改任何引擎数据。 */
function buildPrompt(input: z.infer<typeof importanceSchema>): string {
  const { event, isNewDomain } = input;
  return [
    "你是知识闯关游戏里的记忆系统，需要给一次答题事件打 1-10 的重要度。",
    "判据：答错的题最重要（10）；首次接触的新领域答对较重要（6）；重复答对不重要（3）；连击越高越不重要。",
    '只输出 JSON：{"importance": <1-10 的整数>}，不要任何解释。',
    "",
    `题目：${event.questionId}`,
    `领域：${event.domain} / 知识点：${event.topic} / 难度：${event.difficulty}`,
    `结果：${event.correct ? "答对" : "答错"} / 当前连击：${event.streak}`,
    `是否首次接触该领域：${isNewDomain ? "是" : "否"}`,
    `来源：${event.source === "practice" ? "第 5 题加练（不计分）" : "公共题"}`,
  ].join("\n");
}

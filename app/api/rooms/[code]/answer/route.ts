import { ok, fail, handleError, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS, submitAnswer } from "@/lib/store";
import { answerSchema } from "@/lib/store/validate";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/[code]/answer —— 提交答案。
 *
 * **客户端不传用时**：服务端用收到时刻减去 `startedAt` 计算，
 * 这是「服务端权威计时」的关键 —— 客户端声称的用时一律不可信。
 */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  const limited = rateLimitGuard(req, "answer", RATE_LIMITS.submitAnswer);
  if (limited) return limited;

  const parsed = answerSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  try {
    const result = submitAnswer({
      code: params.code.toUpperCase(),
      playerId: parsed.data.playerId,
      roundIndex: parsed.data.roundIndex,
      answer: parsed.data.answer,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}

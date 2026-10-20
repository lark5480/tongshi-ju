import { ok, fail, handleError, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS, setReady } from "@/lib/store";
import { readySchema } from "@/lib/store/validate";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/[code]/ready —— 设置准备状态。
 *
 * 改变的是**对局共享状态**，因此必须走房间广播（`setReady` 内部已广播全量快照），
 * 绝不能只在本地改 —— 否则双端会失同步。
 */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  const limited = rateLimitGuard(req, "ready", RATE_LIMITS.ready);
  if (limited) return limited;

  const parsed = readySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  try {
    const snapshot = setReady(params.code.toUpperCase(), parsed.data.playerId, parsed.data.ready);
    return ok({ room: snapshot });
  } catch (e) {
    return handleError(e);
  }
}

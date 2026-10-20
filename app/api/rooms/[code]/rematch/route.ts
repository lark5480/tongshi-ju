import { ok, fail, handleError, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS, rematch } from "@/lib/store";
import { rematchSchema } from "@/lib/store/validate";

export const dynamic = "force-dynamic";

/** POST /api/rooms/[code]/rematch —— 再来一局（房主发起）。 */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  const limited = rateLimitGuard(req, "rematch", RATE_LIMITS.rematch);
  if (limited) return limited;

  const parsed = rematchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  try {
    const snapshot = rematch(params.code.toUpperCase(), parsed.data.playerId);
    return ok({ room: snapshot });
  } catch (e) {
    return handleError(e);
  }
}

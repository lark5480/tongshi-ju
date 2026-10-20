import { ok, fail, handleError, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS, startRoom } from "@/lib/store";
import { startSchema } from "@/lib/store/validate";

export const dynamic = "force-dynamic";

/** POST /api/rooms/[code]/start —— 房主开局。 */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  const limited = rateLimitGuard(req, "start-room", RATE_LIMITS.startRoom);
  if (limited) return limited;

  const parsed = startSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  try {
    const snapshot = startRoom(params.code.toUpperCase(), parsed.data.playerId);
    return ok({ room: snapshot });
  } catch (e) {
    return handleError(e);
  }
}

import { ok, fail, handleError, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS, createRoom } from "@/lib/store";
import { createRoomSchema } from "@/lib/store/validate";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms —— 创建房间。
 *
 * 响应中包含**私有的** `playerId`（凭证），这是该凭证唯一一次以明文返回的地方。
 * 客户端必须立刻存进 localStorage，之后所有写操作都从本地取，**不能**从快照里取。
 */
export async function POST(req: Request) {
  const limited = rateLimitGuard(req, "create-room", RATE_LIMITS.createRoom);
  if (limited) return limited;

  const body = await readJson(req);
  const parsed = createRoomSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  try {
    const cred = createRoom({
      name: parsed.data.name,
      emoji: parsed.data.emoji,
      domains: parsed.data.domains,
    });
    return ok(cred, 201);
  } catch (e) {
    return handleError(e);
  }
}

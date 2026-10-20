import { ok, fail, handleError } from "@/lib/api/respond";
import { getSnapshot, getRoom, joinRoom } from "@/lib/store";
import { joinRoomSchema } from "@/lib/store/validate";
import { rateLimitGuard } from "@/lib/rate-limit";
import { RATE_LIMITS } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/[code]/join —— 加入房间。
 *
 * 响应中包含**私有的** `playerId`（凭证）。
 */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  const limited = rateLimitGuard(req, "join-room", RATE_LIMITS.joinRoom);
  if (limited) return limited;

  const body = await (async () => {
    try {
      return await req.json();
    } catch {
      return null;
    }
  })();
  const parsed = joinRoomSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  try {
    const cred = joinRoom({
      code: params.code.toUpperCase(),
      name: parsed.data.name,
      emoji: parsed.data.emoji,
    });
    return ok(cred, 201);
  } catch (e) {
    return handleError(e);
  }
}

/**
 * GET /api/rooms/[code]/join —— 查询房间是否可加入（大厅输入房间码时用）。
 */
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const room = getRoom(params.code.toUpperCase());
  if (!room) return fail("房间不存在或已结束", 404, "room_not_found");
  if (room.status !== "lobby") return fail("对局已经开始，无法加入", 409, "room_started");
  const hasGuest = Object.values(room.players).some((p) => p.slot === 1);
  if (hasGuest) return fail("房间已满", 409, "room_full");
  const snapshot = getSnapshot(params.code.toUpperCase());
  return ok({
    available: true,
    hostName: snapshot?.players.find((p) => p.slot === 0)?.name ?? "玩家",
    domains: snapshot?.domains ?? [],
  });
}

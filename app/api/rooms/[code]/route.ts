import { ok, fail } from "@/lib/api/respond";
import { getPlayerSlot, getSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/[code] —— 获取房间快照。
 *
 * 可选 `?playerId=`：带上凭证时，响应额外返回 `you`（本人在房间中的席位与身份）。
 * **`you` 只出现在这个私有响应里**，不会进入任何广播事件 ——
 * 这样客户端能识别「我是房主吗」，而凭证本身仍不会扩散给第三方。
 */
export async function GET(req: Request, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();
  const snapshot = getSnapshot(code);
  if (!snapshot) return fail("房间不存在或已结束", 404, "room_not_found");

  const playerId = new URL(req.url).searchParams.get("playerId") ?? "";
  let you: { slot: number; isHost: boolean } | null = null;
  if (playerId) {
    const slot = getPlayerSlot(code, playerId);
    if (slot !== null) {
      you = { slot, isHost: slot === snapshot.hostSlot };
    }
  }

  return ok({ room: snapshot, you });
}

/**
 * 房间状态存储层（对外入口）。
 *
 * 实现集中在 `room.ts`（状态机 + 权威计时 + 结算），
 * 校验在 `validate.ts`，常量在 `constants.ts`。
 */

export { RoomError } from "./room";

export {
  createRoom,
  duelWinner,
  getPlayerSlot,
  getRoom,
  getSnapshot,
  joinRoom,
  rematch,
  setConnected,
  setReady,
  startRoom,
  submitAnswer,
  sweepExpiredRooms,
  syncRoomPhase,
  TOTAL_ROUNDS,
  __resetRoomsForTest,
} from "./room";

export { ROOM_LIMITS, STREAM_LIMITS, RATE_LIMITS } from "./constants";

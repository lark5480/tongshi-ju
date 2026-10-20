/**
 * SSE 事件序列化。
 *
 * 约定：
 * - 业务事件的 `event` 名与 `type` 一致，客户端可按事件名订阅；
 * - `rotate` 是一条**独立**的事件名（不进入 `RoomEvent` 联合类型），
 *   用于服务端主动优雅关闭连接前通知客户端立即静默重连。
 */

import type { RoomEvent } from "@/types";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // 关闭 Nginx 等反向代理的缓冲，否则事件会被攒着一起发
  "X-Accel-Buffering": "no",
};

/** 业务事件 → SSE 帧。 */
export function eventToSse(event: RoomEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 主动轮换通知（独立事件名，不属于 RoomEvent）。 */
export const ROTATE_EVENT = "rotate";

export function rotateFrame(): string {
  return `event: ${ROTATE_EVENT}\ndata: {}\n\n`;
}

/** 心跳帧：SSE 注释行，客户端不会触发 message 事件。 */
export function pingFrame(): string {
  return ": ping\n\n";
}

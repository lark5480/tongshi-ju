import { SSE_HEADERS, pingFrame, rotateFrame } from "@/lib/events";
import { acquireSubscriberSlot, addSubscriber, removeSubscriber } from "@/lib/realtime";
import { getSnapshot, setConnected, STREAM_LIMITS } from "@/lib/store";
import type { RoomEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * `/api/rooms/[code]/stream` —— SSE 实时事件流。GET / POST 两条路径行为完全一致，
 * 只是**给不同的取道用**：
 *
 * - **POST**：浏览器客户端用这一条。Cloudflare Quick Tunnel（`play-online.bat` 的
 *   `xxx.trycloudflare.com`）对 **GET 的流式响应整段缓冲**，帧会一直攒到连接关闭才吐出
 *   （实测 100 秒 0 字节，轮换关闭时一次性到达）；同一隧道 POST 则是逐帧实时到达。
 *   所以 `hooks/useRoomStream.ts` 用 `fetch(POST)` + `ReadableStream` 自己读帧，
 *   而不是只能发 GET 的 `EventSource`。
 * - **GET**：浏览器地址栏 / curl 直接查看当前流，也是平台侧口径保留的只读取道。
 *
 * ## 平台超时三件套（必须成套存在，缺一不可）
 *
 * 1. **25s 心跳**：`: ping\n\n` 保活中间代理，同时在写失败时兜底清理；
 * 2. **100s 主动轮换**：平台（EdgeOne 120s / Vercel 60s）会硬杀长连接，
 *    且硬杀时流的 `cancel()` **不保证触发**，死订阅会占满配额导致「重连永远 429」。
 *    因此在超时前先发 `rotate` 事件、再 cleanup + close，把「硬杀残留」变成「清理必执行」。
 *    配套仓库根的 `edgeone.json`：`nodeFunctionsConfig.maxDuration = 120`；
 * 3. **僵尸回收**：连接配额达上限时先回收（同 playerId 的旧连接 / 超龄连接）再拒绝。
 *
 * 客户端行为见 `hooks/useRoomStream.ts`：`rotate` 后静默立即重连，
 * 其余断开一律走指数退避 —— 重连完全由客户端接管。
 */
async function openStream(req: Request, { params }: { params: { code: string } }) {
  const code = params.code.toUpperCase();

  const snapshot = getSnapshot(code);
  if (!snapshot) return new Response("房间不存在", { status: 404 });

  // 玩家连接携带 playerId 用于在线状态；观战不携带
  const playerId = new URL(req.url).searchParams.get("playerId") ?? undefined;

  // 连接安全交给并发上限兜底：SSE 是长连接，按请求频次限流会误伤
  const slot = acquireSubscriberSlot(code, playerId, {
    maxPerRoom: STREAM_LIMITS.MAX_SUBSCRIBERS_PER_ROOM,
    maxTotal: STREAM_LIMITS.MAX_TOTAL_SUBSCRIBERS,
    staleMs: STREAM_LIMITS.STALE_SUBSCRIBER_MS,
  });
  if (slot === "room-full") {
    return new Response("该房间连接数已达上限", {
      status: 429,
      headers: { "Retry-After": "10" },
    });
  }
  if (slot === "global-full") {
    return new Response("服务器连接数已达上限", { status: 503 });
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const timers: {
    ping: ReturnType<typeof setInterval> | null;
    rotate: ReturnType<typeof setTimeout> | null;
  } = { ping: null, rotate: null };
  let cleaned = false;

  /**
   * 幂等清理：由 cancel / 主动轮换 / 心跳写失败三条路径共用。
   * 平台强制掐断时 cancel() 可能不触发，后两条路径保证订阅最终一定被回收。
   */
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timers.ping) clearInterval(timers.ping);
    if (timers.rotate) clearTimeout(timers.rotate);
    if (controllerRef) removeSubscriber(code, controllerRef);
    if (playerId) setConnected(code, playerId, false);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      // 连接即推送当前全量快照，保证重连 / 观战即时同步
      const event: RoomEvent = { type: "state", room: snapshot };
      controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(event)}\n\n`));
      addSubscriber(code, controller, playerId);
      if (playerId) setConnected(code, playerId, true);

      timers.ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(pingFrame()));
        } catch {
          // 下游已断但 cancel 未触发：兜底清理，避免僵尸订阅占住配额
          cleanup();
        }
      }, STREAM_LIMITS.PING_INTERVAL_MS);

      // 主动轮换：平台超时掐断前优雅关闭，客户端收到 rotate 后立即静默重连
      timers.rotate = setTimeout(() => {
        try {
          controller.enqueue(encoder.encode(rotateFrame()));
        } catch {
          /* 已断开 */
        }
        cleanup();
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      }, STREAM_LIMITS.STREAM_MAX_AGE_MS);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export const GET = openStream;
export const POST = openStream;

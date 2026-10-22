/**
 * SSE 帧解析 —— 纯函数，与序列化端 `lib/events.ts` 配对。
 *
 * ## 为什么必须自己解析
 *
 * 客户端用 `fetch` + `ReadableStream` 读事件流（见 `hooks/useRoomStream.ts`），
 * 拿到的是**网络决定的 chunk 边界**：一帧可能被拆成两段，多帧也可能挤在一个 chunk 里。
 * 所以缓冲要跨 chunk 累计，并且**只消费到最后一个完整帧**，剩下的尾巴留给下一批。
 *
 * 帧的判定按 SSE 规范：以空行（`\n\n`）结束；`:` 开头是注释（心跳帧走这一条）；
 * `event:` 是事件名（缺省 `message`）；多行 `data:` 用 `\n` 连接。
 */

export interface SseFrame {
  /** 事件名，与服务端 `event:` 字段一致；缺省为 `message`。 */
  event: string;
  data: string;
}

export interface SseSplit {
  frames: SseFrame[];
  /** 尚未收全的尾部，下一批数据到达后追加再解析。 */
  rest: string;
}

/** 从缓冲中切出所有完整帧，返回它们和未完成的尾部。 */
export function splitSseFrames(buffer: string): SseSplit {
  const frames: SseFrame[] = [];
  let rest = buffer;
  let boundary = rest.indexOf("\n\n");
  while (boundary !== -1) {
    const frame = parseBlock(rest.slice(0, boundary));
    if (frame) frames.push(frame);
    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf("\n\n");
  }
  return { frames, rest };
}

/** 解析单个帧块；注释行 / 只有控制字段（如 `retry:`）的块不产生帧。 */
function parseBlock(block: string): SseFrame | null {
  if (!block) return null;
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // 规范允许 `key:value` 与 `key: value` 两种写法，冒号后的**第一个**空格属于分隔符
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return null;
  return { event, data: data.join("\n") };
}

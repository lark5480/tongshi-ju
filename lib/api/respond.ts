/**
 * API 路由的统一响应工具。
 */

import { RoomError } from "@/lib/store/room";

/** JSON 成功响应。 */
export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** JSON 错误响应。 */
export function fail(message: string, status = 400, code = "error"): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 把异常转成合适的响应：`RoomError` 保留其状态码，其余归为 500。 */
export function handleError(e: unknown): Response {
  if (e instanceof RoomError) {
    return fail(e.message, e.status, e.code);
  }
  console.error("[api] 未预期的错误：", e);
  return fail("服务器内部错误，请稍后再试", 500, "internal_error");
}

/** 解析 JSON 请求体；失败时返回 null。 */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * 进程内滑动窗口限流（单实例内存版，重启即清零）。
 * 仅用于防滥用，不追求精确计数。
 *
 * 注意：IP 取自 X-Forwarded-For / X-Real-IP，仅在可信反向代理（如 Vercel / EdgeOne）
 * 后面才可靠；直连部署时该头可被伪造，限流只能防君子不防刻意伪造者。
 */
const hits = new Map<string, number[]>();

/** 从请求头解析客户端 IP（各 API 路由共用）。 */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function allowRequest(key: string, limit: number, windowMs: number): boolean {
  const nowTs = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => nowTs - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return false;
  }
  arr.push(nowTs);
  hits.set(key, arr);
  return true;
}

/** 清理窗口外已无记录的 key，防止 Map 无限增长（由房间清扫定期调用）。 */
export function pruneRateLimit(windowMs: number): void {
  const nowTs = Date.now();
  for (const [key, arr] of hits) {
    if (!arr.some((t) => nowTs - t < windowMs)) hits.delete(key);
  }
}

/**
 * API 路由限流守卫：按 IP + scope 滑动窗口计数。
 * 返回 429 响应或 null（放行）。所有写路由都应调用。
 */
export function rateLimitGuard(
  req: Request,
  scope: string,
  limit: number,
  windowMs = 60_000
): Response | null {
  const ip = clientIp(req);
  if (!allowRequest(`${scope}:${ip}`, limit, windowMs)) {
    return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

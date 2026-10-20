/**
 * 「今天」的统一口径 —— 全项目按 `Asia/Shanghai` 划分日期。
 *
 * 规则（§8.1 / R8）：
 * - 服务端是**唯一**的「今天」来源，客户端不自算；
 * - 每日挑战的 `daySeed` 依赖这个日期字符串，因此跨时区玩家看到的题目一致；
 * - 跨零点时，日期由服务端下发的 `daySeed` 决定，客户端不本地滚动。
 */

/** 按 `Asia/Shanghai` 取 `YYYY-MM-DD`。 */
export function dayKey(timeZone = "Asia/Shanghai", now: Date = new Date()): string {
  // en-CA 的 dateStyle 输出即 YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 日期字符串 → 紧凑整数（用于可读的种子与排序）。 */
export function dayNumber(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/** 在「今天」基础上偏移若干天，返回新的 `YYYY-MM-DD`。 */
export function shiftDay(dateKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 两个 `YYYY-MM-DD` 相差的天数（a - b）。 */
export function daysBetween(a: string, b: string): number {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!pa || !pb) return 0;
  const ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  const tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((ta - tb) / 86400000);
}

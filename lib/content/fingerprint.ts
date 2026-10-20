/**
 * 题干指纹 —— 去重的第一道关口。
 *
 * 归一化：去所有空白与标点 → 全角转半角 → 英文小写。
 * 归一化后取 32 位哈希，相同指纹即视为「同一道题」。
 *
 * 该模块被三方共用：题库校验脚本、AI 校验链、题库入库。
 * 保持**无依赖**，以便 `.mjs` 脚本与运行时都能引用。
 */

/** 全角 → 半角。 */
function toHalfWidth(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 题干归一化（用于指纹与近似去重）。 */
export function normalizeStem(stem: string): string {
  return toHalfWidth(stem)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：""''（）【】《》…—·,.!?;:"'()[\]{}<>~`@#$%^&*_+=|\\/]/g, "");
}

/** FNV-1a 32 位哈希。 */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 题干指纹（8 位十六进制）。 */
export function fingerprintOf(stem: string): string {
  return fnv1a(normalizeStem(stem)).toString(16).padStart(8, "0");
}

/** 粗分词：按中英文数字切出 token 集合，用于 Jaccard 近似去重。 */
export function tokenize(text: string): Set<string> {
  const normalized = toHalfWidth(text).toLowerCase();
  const tokens = new Set<string>();
  // 英文/数字按连续片段切分
  for (const m of normalized.matchAll(/[a-z0-9]+/g)) tokens.add(m[0]);
  // 中文按 2-gram 切分
  const chinese = normalized.replace(/[^一-鿿]/g, "");
  for (let i = 0; i + 1 < chinese.length; i++) {
    tokens.add(chinese.slice(i, i + 2));
  }
  if (chinese.length === 1) tokens.add(chinese);
  return tokens;
}

/** Jaccard 相似度。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

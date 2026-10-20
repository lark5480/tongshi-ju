/**
 * 去重 —— 校验链的第 8、9 步。
 *
 * 两道防线：
 * 1. **指纹去重**：题干归一化后哈希，相同即判重（能抓出只差标点空白的重复题）；
 * 2. **近似去重**：同域内用 token 集合的 Jaccard 相似度，> 0.85 判为近似重复。
 *
 * 指纹来自 `lib/content/fingerprint`，与题库校验脚本共用同一套算法，
 * 保证「AI 出的题」与「人工写的题」用同一把尺子量。
 */

import { fingerprintOf, jaccard, normalizeStem, tokenize } from "@/lib/content/fingerprint";
import type { DomainId, Question } from "@/types";

/** 近似重复阈值。 */
export const NEAR_DUP_THRESHOLD = 0.85;

/** 单个域的现有题干 token 索引。 */
export type DomainTokenIndex = Map<DomainId, { id: string; tokens: Set<string> }[]>;

export interface DedupeVerdict {
  duplicate: boolean;
  /** 命中的重复来源（指纹命中时是同一指纹的题 id）。 */
  against?: string;
  /** 命中时的相似度（近似去重时有效）。 */
  similarity?: number;
}

/**
 * 指纹查重。
 *
 * @param knownFingerprints 全库已有指纹；Map 时值为题 id，Set 时仅做存在性判断
 */
export function checkFingerprint(
  stem: string,
  knownFingerprints: ReadonlyMap<string, string> | ReadonlySet<string>
): DedupeVerdict {
  const fp = fingerprintOf(stem);
  // ReadonlySet 与 ReadonlyMap 结构不同，用属性探测做收窄
  if ("get" in knownFingerprints) {
    const hit = knownFingerprints.get(fp);
    return hit ? { duplicate: true, against: hit } : { duplicate: false };
  }
  return knownFingerprints.has(fp) ? { duplicate: true, against: fp } : { duplicate: false };
}

/**
 * 近似查重（限同域）。
 *
 * @param index 该域已有题目的 token 索引
 */
export function checkNearDuplicate(
  stem: string,
  domain: DomainId,
  index: DomainTokenIndex
): DedupeVerdict {
  const tokens = tokenize(normalizeStem(stem));
  const list = index.get(domain) ?? [];
  let best: { id: string; similarity: number } | null = null;
  for (const other of list) {
    const similarity = jaccard(tokens, other.tokens);
    if (similarity > NEAR_DUP_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { id: other.id, similarity };
    }
  }
  if (best) return { duplicate: true, against: best.id, similarity: best.similarity };
  return { duplicate: false };
}

/** 把一批题目加入 token 索引（用于批内互相查重）。 */
export function addToIndex(index: DomainTokenIndex, question: Question): void {
  const list = index.get(question.domain) ?? [];
  list.push({ id: question.id, tokens: tokenize(normalizeStem(question.stem)) });
  index.set(question.domain, list);
}

/**
 * 错题间隔重逢（SM-2 简化版）。
 *
 * 间隔序列：1 → 3 → 7 → 15 → 30 天。
 * - 答错：连击归零、难度因子下调、间隔重置回第 1 级；
 * - 答对：连击 +1，间隔推进到下一级；
 * - 连续答对 2 次 → **毕业**（返回 null，表示从错题队列移出）。
 *
 * 「重逢」出题优先用**变体题**（同 topic 不同问法），变体不可用时降级为原题重现。
 */

import type { WrongEntry } from "@/types";

/** 间隔序列（天）。 */
export const INTERVALS_DAYS = [1, 3, 7, 15, 30] as const;

/** 连续答对多少次即毕业。 */
export const GRADUATE_STREAK = 2;

const DAY_MS = 86400000;

export interface WrongParams {
  questionId: string;
  domain: WrongEntry["domain"];
  topic: string;
  now: number;
}

/** 新建错题条目。 */
export function createWrongEntry(params: WrongParams): WrongEntry {
  return {
    questionId: params.questionId,
    domain: params.domain,
    topic: params.topic,
    streak: 0,
    wrongCount: 1,
    lastWrongAt: params.now,
    ease: 2.5,
    nextDueAt: params.now + INTERVALS_DAYS[0] * DAY_MS,
  };
}

/** 答错：连击归零、间隔重置、ease 下调。 */
export function onWrong(entry: WrongEntry, now: number): WrongEntry {
  const ease = Math.max(1.3, entry.ease - 0.2);
  return {
    ...entry,
    streak: 0,
    wrongCount: entry.wrongCount + 1,
    lastWrongAt: now,
    ease,
    nextDueAt: now + INTERVALS_DAYS[0] * DAY_MS,
  };
}

/**
 * 答对：连击 +1 并推进间隔；达到毕业阈值返回 null。
 * ease 越高间隔推进越快（上限不超过序列末位）。
 */
export function onCorrect(entry: WrongEntry, now: number): WrongEntry | null {
  const streak = entry.streak + 1;
  if (streak >= GRADUATE_STREAK) return null; // 毕业

  const level = Math.min(INTERVALS_DAYS.length - 1, entry.streak);
  const boost = entry.ease >= 2.5 ? 1 : 0; // ease 偏低时留在当前级
  const days = INTERVALS_DAYS[Math.min(INTERVALS_DAYS.length - 1, level + boost)];
  return {
    ...entry,
    streak,
    ease: Math.min(3.0, entry.ease + 0.1),
    nextDueAt: now + days * DAY_MS,
  };
}

/** 是否到期待复习。 */
export function isDue(entry: WrongEntry, now: number): boolean {
  return now >= entry.nextDueAt;
}

/** 过滤出到期的错题。 */
export function dueEntries(entries: readonly WrongEntry[], now: number): WrongEntry[] {
  return entries.filter((e) => isDue(e, now));
}

/** 错题队列的掌握进度（0-1），用于错题本页展示。 */
export function masteryRatio(entries: readonly WrongEntry[]): number {
  if (entries.length === 0) return 1;
  const total = entries.reduce((s, e) => s + e.streak, 0);
  return Math.min(1, total / (entries.length * GRADUATE_STREAK));
}

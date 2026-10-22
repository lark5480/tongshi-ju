/**
 * 到期错题的独立练习出口。
 *
 * 与每日挑战完全分离：这里只按错题队列的 `nextDueAt` 取题，
 * **不参与** `buildDailySet`，不改变每日题集、影子口径或全网同题性质。
 * 作答只推进错题间隔（`onCorrect` / `onWrong`），不计分、不写战绩。
 */

import type { DomainId, Question, WrongEntry } from "@/types";

import { dueEntries } from "./repetition";
import { hashSeed } from "./prng";
import { shuffleOptions } from "./options";

/** 一轮最多复习多少道到期错题。 */
export const PRACTICE_LIMIT = 10;

export interface PracticePick {
  entry: WrongEntry;
  question: Question;
}

/**
 * 从错题队列与题池构造一轮练习题。
 *
 * - 只取**已到期**的条目；
 * - 按 `nextDueAt` 升序、同一时刻按 `questionId` 字典序，保证确定性；
 * - 题池里找不到完整题目的条目直接跳过（不报错）；
 * - 同一 `questionId` 只取一次；最多 `limit` 条。
 */
export function buildPracticeSet(
  entries: readonly WrongEntry[],
  pool: Partial<Record<DomainId, Question[]>>,
  now: number,
  limit = PRACTICE_LIMIT
): PracticePick[] {
  if (limit <= 0) return [];

  const due = dueEntries(entries, now).sort(
    (a, b) =>
      a.nextDueAt - b.nextDueAt ||
      (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0)
  );

  const picks: PracticePick[] = [];
  const seen = new Set<string>();

  for (const entry of due) {
    if (picks.length >= limit) break;
    if (seen.has(entry.questionId)) continue;

    const question = pool[entry.domain]?.find((q) => q.id === entry.questionId);
    if (!question) continue;

    seen.add(entry.questionId);
    picks.push({
      entry,
      question: shuffleOptions(
        question,
        hashSeed("practice:" + entry.questionId + ":" + entry.nextDueAt)
      ),
    });
  }

  return picks;
}

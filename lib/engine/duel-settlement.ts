/**
 * duel 结算 → 本地档案的纯函数映射。
 *
 * 服务端权威结果（`RoomSnapshot`）决定写什么：本函数只做「快照 → 待写入项」的转换，
 * **不碰 localStorage、不碰时间**（`date` 由调用方传入）。
 * 真正落盘仍由 `lib/storage.ts` 的 `recordAttempt` / `pushHistory` 负责。
 *
 * 只有**本人实际作答过**的回合才进入 `attempts`：
 * 被对手抢先 / 自己未作答的题既不算熟练度，也不进错题本。
 */

import type { DomainId, HistoryEntry, RoomSnapshot, Slot } from "@/types";

import { maxScore, starRating } from "@/lib/engine/scoring";

export interface DuelAttempt {
  questionId: string;
  domain: DomainId;
  topic: string;
  correct: boolean;
}

export interface DuelSettlement {
  matchId: string;
  history: HistoryEntry;
  attempts: DuelAttempt[];
}

/**
 * 构造本场对局的本地结算计划。
 *
 * 仅当对局已结束、已有回合记录、且 `slot` 确实是本场玩家时返回；
 * 否则返回 null（未开局 / 已重开 / 席位不存在都不写档案）。
 */
export function buildDuelSettlement(
  room: RoomSnapshot,
  slot: Slot,
  date: string
): DuelSettlement | null {
  if (room.status !== "finished") return null;
  if (room.history.length === 0) return null;

  const player = room.players.find((p) => p.slot === slot);
  if (!player) return null;

  const key = String(slot);
  const attempts: DuelAttempt[] = [];
  for (const record of room.history) {
    const elapsed = record.elapsed[key];
    if (elapsed === null || elapsed === undefined) continue;
    attempts.push({
      questionId: record.questionId,
      domain: record.domain,
      topic: record.topic,
      correct: record.correct[key] === true,
    });
  }

  const score = room.scores[key] ?? 0;
  const correct = attempts.filter((a) => a.correct).length;

  return {
    matchId: room.matchId,
    history: {
      date,
      domains: [...room.domains],
      score,
      correct,
      total: room.history.length,
      stars: starRating(score, maxScore(room.questions.map((q) => q.difficulty))),
      maxCombo: player.maxCombo,
      mode: "duel",
      roomCode: room.code,
    },
    attempts,
  };
}

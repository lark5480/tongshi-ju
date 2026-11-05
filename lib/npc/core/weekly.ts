/**
 * NPC 引擎 · 本周周报（纯函数）
 *
 * 只做聚合与确定性模板，不读存储、不发请求。
 *
 * 口径（与战绩页一致）：
 * - 只统计**每日挑战 v2**（4 题计分）；v1 与 duel 不混入，避免两种满分口径被
 *   画进同一段回顾；
 * - 加练题单独汇总，不计入正确率（它本来就不计分）；
 * - 域级薄弱度只取公共题（`source !== "practice"`），因为加练题按设计会偏向
 *   最弱域，混进来会把结论说得更弱。
 */

import { domainName } from "@/content/domains";
import { PUBLIC_DAILY_COUNT, SCORING_VERSION, scoringVersionOf } from "@/lib/engine/scoring";
import { hashSeed } from "@/lib/engine/prng";
import type { DomainId } from "@/types";

export interface WeeklyBounds {
  /** 周一的日期 `YYYY-MM-DD`（同时作为缓存键的一部分）。 */
  readonly weekKey: string;
  readonly from: string;
  readonly to: string;
}

/** 一局每日挑战里周报需要的字段（不依赖 DailySession 全量形状）。 */
export interface WeeklySessionInput {
  readonly date: string;
  readonly done: boolean;
  readonly score?: number;
  readonly correct?: number;
  readonly scoringVersion?: 1 | 2;
}

/** 一条已按周区间过滤过的情景记忆（IO 层负责过滤）。 */
export interface WeeklyEpisodeInput {
  readonly domain: DomainId;
  readonly correct: boolean;
  readonly source?: "public" | "practice";
}

export interface WeeklyPractice {
  readonly shown: number;
  readonly answered: number;
  readonly correct: number;
  readonly skipped: number;
}

export interface WeeklyDigestInput {
  readonly weekKey: string;
  readonly from: string;
  readonly to: string;
  readonly sessions: readonly WeeklySessionInput[];
  readonly episodes: readonly WeeklyEpisodeInput[];
  readonly practice: WeeklyPractice;
}

export interface WeeklyDigest {
  readonly weekKey: string;
  readonly from: string;
  readonly to: string;
  readonly sessions: number;
  readonly answered: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly scoreTotal: number;
  readonly bestScore: number;
  readonly activeDays: number;
  readonly domains: readonly { domain: DomainId; attempts: number; wrongs: number }[];
  readonly weakestDomain?: DomainId;
  readonly practice: WeeklyPractice;
}

/**
 * 周界：`Asia/Shanghai` 周一 00:00 起算，区间 `[周一, 今天]`。
 *
 * `weekKey` 直接用周一日期，不用 ISO 周号 —— 跨年时不会出现「第 1 周属于去年」
 * 这类歧义，也能直接当缓存键。
 */
export function weekBounds(todayKey: string): WeeklyBounds {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayKey);
  if (!m) return { weekKey: todayKey, from: todayKey, to: todayKey };

  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // getUTCDay: 0 = 周日；换算成「周一 = 0」的偏移。
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  const weekKey = date.toISOString().slice(0, 10);
  return { weekKey, from: weekKey, to: todayKey };
}

export function buildWeeklyDigest(input: WeeklyDigestInput): WeeklyDigest {
  const sessions = input.sessions.filter((s) => s.done && scoringVersionOf(s) === SCORING_VERSION);

  const answered = sessions.length * PUBLIC_DAILY_COUNT;
  const correct = sessions.reduce((sum, s) => sum + Math.max(0, s.correct ?? 0), 0);
  const scoreTotal = sessions.reduce((sum, s) => sum + Math.max(0, s.score ?? 0), 0);
  const bestScore = sessions.reduce((max, s) => Math.max(max, Math.max(0, s.score ?? 0)), 0);
  const activeDays = new Set(sessions.map((s) => s.date)).size;

  const byDomain = new Map<string, { attempts: number; wrongs: number }>();
  for (const episode of input.episodes) {
    if (episode.source === "practice") continue;
    const row = byDomain.get(episode.domain) ?? { attempts: 0, wrongs: 0 };
    row.attempts += 1;
    if (!episode.correct) row.wrongs += 1;
    byDomain.set(episode.domain, row);
  }

  const domains = [...byDomain.entries()]
    .map(([domain, row]) => ({ domain: domain as DomainId, ...row }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  // 最弱域：错最多；同错数看答题量；再同则按领域 id 稳定排序。
  const weakest = domains
    .filter((d) => d.wrongs > 0)
    .sort(
      (a, b) => b.wrongs - a.wrongs || b.attempts - a.attempts || a.domain.localeCompare(b.domain)
    )[0];

  return {
    weekKey: input.weekKey,
    from: input.from,
    to: input.to,
    sessions: sessions.length,
    answered,
    correct,
    accuracy: answered > 0 ? correct / answered : 0,
    scoreTotal,
    bestScore,
    activeDays,
    domains,
    ...(weakest ? { weakestDomain: weakest.domain } : {}),
    practice: input.practice,
  };
}

/** 确定性模板：无模型 / 模型失败时的兜底，也是服务端返回的对照底稿。 */
export function buildWeeklyTemplate(digest: WeeklyDigest): string {
  if (digest.sessions === 0) return "本周还没开始，做完一次每日挑战就能看到回顾。";

  const parts = [
    `本周完成 ${digest.sessions} 次每日挑战，答对 ${digest.correct}/${digest.answered} 题（${Math.round(
      digest.accuracy * 100
    )}%）。`,
  ];

  const weak = digest.weakestDomain
    ? digest.domains.find((d) => d.domain === digest.weakestDomain)
    : undefined;
  if (weak && weak.wrongs > 0) {
    parts.push(`「${domainName(weak.domain)}」错得最多（${weak.wrongs} 次），下周可以先补它。`);
  } else {
    parts.push("本周没有答错，保持这个状态。");
  }

  if (digest.practice.shown > 0) {
    parts.push(`加练题作答 ${digest.practice.answered} 天，跳过 ${digest.practice.skipped} 天。`);
  }

  return parts.join("");
}

/**
 * 数据指纹：数据变了才重新调模型（缓存键另含 userId + weekKey）。
 *
 * 域顺序不影响结果 —— 指纹只依赖聚合值，避免同一份数据因遍历顺序不同重复计费。
 */
export function weeklyFingerprint(digest: WeeklyDigest): number {
  const domains = [...digest.domains]
    .sort((a, b) => a.domain.localeCompare(b.domain))
    .map((d) => `${d.domain}:${d.attempts}:${d.wrongs}`)
    .join(",");
  return hashSeed(
    [
      digest.weekKey,
      digest.sessions,
      digest.answered,
      digest.correct,
      digest.scoreTotal,
      digest.bestScore,
      digest.activeDays,
      domains,
      digest.practice.shown,
      digest.practice.answered,
      digest.practice.correct,
      digest.practice.skipped,
    ].join("|")
  );
}

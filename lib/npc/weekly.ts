/**
 * 老师 NPC · 本周周报的宿主接入层
 *
 * 职责：从既有存储收集本周数据 → 纯函数聚合 → 调 `/api/npc/weekly` 换一段回顾。
 *
 * 缓存纪律：
 * - 键 = `userId + weekKey`，值带数据指纹；**数据没变不再请求**，避免进一次战绩页
 *   就烧一次模型；
 * - 只缓存模型成功文本；模板降级不缓存，下次还能重试恢复。
 */

import { dayKey, shiftDay } from "@/lib/engine/date";
import { getDailySession, getPracticeFunnelSummary, readJson, writeJson } from "@/lib/storage";

import { loadCoachEpisodes } from "./client";
import {
  buildWeeklyDigest,
  buildWeeklyTemplate,
  weekBounds,
  weeklyFingerprint,
  type WeeklyDigest,
  type WeeklyEpisodeInput,
  type WeeklySessionInput,
} from "./core/weekly";

/** localStorage 键（按 `userId:weekKey` 再分区）。 */
export const WEEKLY_CACHE_KEY = "npc-weekly";

interface WeeklyCacheEntry {
  readonly fingerprint: number;
  readonly text: string;
  readonly at: number;
  readonly provider?: string;
}

type WeeklyCache = Record<string, WeeklyCacheEntry>;

export interface WeeklyReport {
  /** `model` = 模型回顾；`template` = 显式降级；`empty` = 本周没有可统计的挑战。 */
  readonly status: "model" | "template" | "empty";
  readonly text: string;
  readonly digest: WeeklyDigest;
  readonly degradedReason?: string;
  /** 是否命中本地缓存（命中时没有发起网络请求）。 */
  readonly cached: boolean;
}

/**
 * 同一份数据只允许一个在途请求。
 *
 * React StrictMode 在开发环境会双挂载 effect；没有这层复用，
 * 进一次战绩页会打两次模型。
 */
const weeklyInflight = new Map<string, Promise<WeeklyReport>>();

/** 收集本周数据并聚合（纯读，不发请求）。 */
export function collectWeeklyDigest(userId: string, now: number): WeeklyDigest {
  const today = dayKey("Asia/Shanghai", new Date(now));
  const bounds = weekBounds(today);

  const sessions: WeeklySessionInput[] = [];
  for (let cursor = bounds.from; cursor <= bounds.to; cursor = shiftDay(cursor, 1)) {
    const session = getDailySession(cursor);
    if (!session) continue;
    sessions.push({
      date: session.date,
      done: session.done,
      score: session.score,
      correct: session.correct,
      scoringVersion: session.scoringVersion,
    });
  }

  const episodes: WeeklyEpisodeInput[] = [];
  for (const episode of loadCoachEpisodes(userId)) {
    const key = dayKey("Asia/Shanghai", new Date(episode.at));
    if (key < bounds.from || key > bounds.to) continue;
    episodes.push({ domain: episode.domain, correct: episode.correct, source: episode.source });
  }

  const practice = getPracticeFunnelSummary(bounds.from, bounds.to);

  return buildWeeklyDigest({
    ...bounds,
    sessions,
    episodes,
    practice: {
      shown: practice.shown,
      answered: practice.answered,
      correct: practice.correct,
      skipped: practice.skipped,
    },
  });
}

/**
 * 取本周周报（**永不抛错**）。
 *
 * 流程：聚合 → 空周直接返回 → 缓存命中直接返回 → 请求服务端 → 失败降级模板。
 */
export async function getWeeklyReport(params: {
  readonly userId: string;
  readonly now: number;
}): Promise<WeeklyReport> {
  const digest = collectWeeklyDigest(params.userId, params.now);
  const template = (degradedReason: string, text?: string): WeeklyReport => ({
    status: "template",
    text: text?.trim() || buildWeeklyTemplate(digest),
    digest,
    degradedReason,
    cached: false,
  });

  if (digest.sessions === 0) {
    return {
      status: "empty",
      text: buildWeeklyTemplate(digest),
      digest,
      cached: false,
    };
  }

  const key = `${params.userId}:${digest.weekKey}`;
  const fingerprint = weeklyFingerprint(digest);
  const raw = readJson<WeeklyCache>(WEEKLY_CACHE_KEY, {});
  const cache: WeeklyCache = raw && typeof raw === "object" ? raw : {};
  const hit = cache[key];
  if (hit && hit.fingerprint === fingerprint) {
    return { status: "model", text: hit.text, digest, cached: true };
  }

  const inflightKey = `${key}:${fingerprint}`;
  const pendingRequest = weeklyInflight.get(inflightKey);
  if (pendingRequest) return pendingRequest;

  const task = (async (): Promise<WeeklyReport> => {
    try {
      const res = await fetch("/api/npc/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(digest),
      });
      if (!res.ok) return template(`周报服务不可用（HTTP ${res.status}）`);

      const data = (await res.json()) as {
        text?: unknown;
        degraded?: unknown;
        degradedReason?: string | null;
        templateText?: string | null;
        provider?: string | null;
      };

      if (data.degraded === true || typeof data.text !== "string" || !data.text.trim()) {
        return template(
          data.degradedReason ?? "模型未返回可用周报",
          typeof data.templateText === "string" ? data.templateText : undefined
        );
      }

      const text = data.text.trim();
      writeJson(WEEKLY_CACHE_KEY, {
        ...cache,
        [key]: {
          fingerprint,
          text,
          at: params.now,
          ...(typeof data.provider === "string" && data.provider
            ? { provider: data.provider }
            : {}),
        },
      });
      return { status: "model", text, digest, cached: false };
    } catch (error) {
      return template(`周报请求失败：${error instanceof Error ? error.message : String(error)}`);
    }
  })();

  weeklyInflight.set(inflightKey, task);
  try {
    return await task;
  } finally {
    weeklyInflight.delete(inflightKey);
  }
}

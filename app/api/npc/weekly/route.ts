/**
 * POST /api/npc/weekly —— 老师 NPC 的本周周报
 *
 * 与点评路由同一套纪律：
 * - 未配置 provider → **200 + degraded: true + 模板周报**（不是 503，这是预期降级路径）；
 * - 模型失败 / 超时 / 空正文 → 同样降级，不抛错；
 * - 密钥只在服务端；
 * - 入参只收**聚合后的数字**，不收原始题目或答案。
 */

import { fail, ok, readJson } from "@/lib/api/respond";
import { rateLimitGuard } from "@/lib/rate-limit";
import { getProvider } from "@/lib/ai/provider";
import { z } from "zod";

import { narrateWeeklyReport } from "@/lib/npc";
import { buildWeeklyTemplate, type WeeklyDigest } from "@/lib/npc/core/weekly";
import type { DomainId } from "@/types";

export const dynamic = "force-dynamic";

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const weeklyDigestSchema = z.object({
  weekKey: DAY,
  from: DAY,
  to: DAY,
  sessions: z.number().int().min(0).max(7),
  answered: z.number().int().min(0).max(28),
  correct: z.number().int().min(0).max(28),
  accuracy: z.number().min(0).max(1),
  scoreTotal: z.number().int().min(0),
  bestScore: z.number().int().min(0),
  activeDays: z.number().int().min(0).max(7),
  domains: z
    .array(
      z.object({
        domain: z.string().min(1).max(32),
        attempts: z.number().int().min(0),
        wrongs: z.number().int().min(0),
      })
    )
    .max(12),
  weakestDomain: z.string().min(1).max(32).optional(),
  practice: z.object({
    shown: z.number().int().min(0).max(7),
    answered: z.number().int().min(0).max(7),
    correct: z.number().int().min(0).max(7),
    skipped: z.number().int().min(0).max(7),
  }),
});

export async function POST(req: Request) {
  const limited = rateLimitGuard(req, "npc-weekly", 6);
  if (limited) return limited;

  const parsed = weeklyDigestSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "参数不合法", 400, "invalid_input");
  }

  const { weakestDomain, domains, ...rest } = parsed.data;
  const digest: WeeklyDigest = {
    ...rest,
    domains: domains.map((d) => ({
      ...d,
      domain: d.domain as DomainId,
    })),
    ...(weakestDomain ? { weakestDomain: weakestDomain as DomainId } : {}),
  };

  const provider = getProvider();
  const result = await narrateWeeklyReport({
    digest,
    model: provider
      ? {
          name: provider.name,
          generate: provider.generate.bind(provider),
          generateWithMeta: provider.generateWithMeta.bind(provider),
        }
      : null,
  });

  return ok({
    text: result.text,
    degraded: result.degraded,
    degradedReason: result.degradedReason ?? null,
    provider: provider?.name ?? null,
    /** 模板底稿：降级时的对照，便于确认模型版本改了没有。 */
    templateText: buildWeeklyTemplate(digest),
  });
}

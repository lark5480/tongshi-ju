/**
 * 题库加载器（客户端安全）。
 *
 * 按域**动态 import**：每日挑战只加载玩家选中的 3 个域，
 * 避免把 12 个域全部打进首屏 bundle（docs/ARCHITECTURE.md §6 内容管线）。
 *
 * 动态 import 必须写成字面量（`() => import("@/content/domains/gaming.json")`），
 * 否则打包器无法静态分析，Next.js 会报「Module not found」。
 *
 * 磁盘上的 JSON 默认导出形态是 `{ domain, questions }`（见 content/domains/schema.ts），
 * 加载时注入 `domain` / `origin` / `fingerprint` 三个运行时字段。
 */

import type { DomainId, Question } from "@/types";
import { fingerprintOf } from "./fingerprint";

/** 磁盘上的单题形态（与 content/domains/schema.ts 一致）。 */
export interface QuestionFileEntry {
  id: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  type: "single" | "multi" | "judge";
  stem: string;
  options: string[];
  answer: string | string[];
  explanation: string;
  source?: { title: string; url?: string };
}

/** 已人工审核入库的 AI 题：比 seed 多 `batchId` / `reviewedAt`。 */
export interface AiQuestionFileEntry extends QuestionFileEntry {
  batchId: string;
  reviewedAt: string;
  variantOf?: string;
}

/** JSON 模块的默认导出形态。 */
type QuestionModule = { default: { domain: DomainId; questions: QuestionFileEntry[] } };
type AiQuestionModule = { default: { domain: DomainId; questions: AiQuestionFileEntry[] } };

const LOADERS: Record<DomainId, () => Promise<QuestionModule>> = {
  gaming: () => import("@/content/domains/gaming.json") as Promise<QuestionModule>,
  anime: () => import("@/content/domains/anime.json") as Promise<QuestionModule>,
  auto: () => import("@/content/domains/auto.json") as Promise<QuestionModule>,
  tech: () => import("@/content/domains/tech.json") as Promise<QuestionModule>,
  mobile: () => import("@/content/domains/mobile.json") as Promise<QuestionModule>,
  life: () => import("@/content/domains/life.json") as Promise<QuestionModule>,
  coding: () => import("@/content/domains/coding.json") as Promise<QuestionModule>,
  history: () => import("@/content/domains/history.json") as Promise<QuestionModule>,
  film: () => import("@/content/domains/film.json") as Promise<QuestionModule>,
  science: () => import("@/content/domains/science.json") as Promise<QuestionModule>,
  literature: () => import("@/content/domains/literature.json") as Promise<QuestionModule>,
  travel: () => import("@/content/domains/travel.json") as Promise<QuestionModule>,
};

/**
 * AI 题加载器 —— 与 seed 分开动态加载。
 *
 * 每日挑战只加载选中的 3 个域，AI 题同样按域懒加载；批准入库的 AI 题只影响
 * PK / 错题复习 / 第 5 题加练，不会进入每日题集（由 `buildDailySet` 的来源过滤保证）。
 */
const AI_LOADERS: Record<DomainId, () => Promise<AiQuestionModule>> = {
  gaming: () => import("@/content/ai/gaming.json") as Promise<AiQuestionModule>,
  anime: () => import("@/content/ai/anime.json") as Promise<AiQuestionModule>,
  auto: () => import("@/content/ai/auto.json") as Promise<AiQuestionModule>,
  tech: () => import("@/content/ai/tech.json") as Promise<AiQuestionModule>,
  mobile: () => import("@/content/ai/mobile.json") as Promise<AiQuestionModule>,
  life: () => import("@/content/ai/life.json") as Promise<AiQuestionModule>,
  coding: () => import("@/content/ai/coding.json") as Promise<AiQuestionModule>,
  history: () => import("@/content/ai/history.json") as Promise<AiQuestionModule>,
  film: () => import("@/content/ai/film.json") as Promise<AiQuestionModule>,
  science: () => import("@/content/ai/science.json") as Promise<AiQuestionModule>,
  literature: () => import("@/content/ai/literature.json") as Promise<AiQuestionModule>,
  travel: () => import("@/content/ai/travel.json") as Promise<AiQuestionModule>,
};

/** 把磁盘形态转换为运行时完整题目。 */
export function hydrate(
  domain: DomainId,
  entries: readonly QuestionFileEntry[],
  origin: Question["origin"] = "seed"
): Question[] {
  return entries.map((e) => ({
    ...e,
    domain,
    origin,
    fingerprint: fingerprintOf(e.stem),
  }));
}

/** 加载单个领域的全部题目（seed + 已审核 AI 题）。 */
export async function loadDomainQuestions(domain: DomainId): Promise<Question[]> {
  const [seed, ai] = await Promise.all([LOADERS[domain](), AI_LOADERS[domain]()]);
  return [
    ...hydrate(domain, seed.default?.questions ?? []),
    ...hydrate(domain, ai.default?.questions ?? [], "ai"),
  ];
}

/** 批量加载多个领域，合并为一个题池。 */
export async function loadQuestionPool(
  domains: readonly DomainId[]
): Promise<Partial<Record<DomainId, Question[]>>> {
  const entries = await Promise.all(
    domains.map(async (d) => [d, await loadDomainQuestions(d)] as const)
  );
  return Object.fromEntries(entries) as Partial<Record<DomainId, Question[]>>;
}

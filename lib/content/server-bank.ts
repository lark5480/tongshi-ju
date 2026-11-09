/**
 * 服务端题库（**含答案与解析**）—— 只允许在服务端代码中 import。
 *
 * 与 `lib/content/loader.ts`（客户端动态加载）严格分离：本文件静态引入全部 12 个域，
 * 供服务端做答案判定；它**永远不会被打进浏览器 bundle**。
 *
 * ⚠️ 答案保密：这些题目的 `answer` / `explanation` 绝不允许出现在
 * 房间快照、`round_start` 事件或任何 API 响应中，只在 `round_result` 结算时公布。
 */

import type { DomainId, Question } from "@/types";

import gaming from "@/content/domains/gaming.json";
import anime from "@/content/domains/anime.json";
import auto from "@/content/domains/auto.json";
import tech from "@/content/domains/tech.json";
import mobile from "@/content/domains/mobile.json";
import life from "@/content/domains/life.json";
import coding from "@/content/domains/coding.json";
import history from "@/content/domains/history.json";
import film from "@/content/domains/film.json";
import science from "@/content/domains/science.json";
import literature from "@/content/domains/literature.json";
import travel from "@/content/domains/travel.json";

import gamingAi from "@/content/ai/gaming.json";
import animeAi from "@/content/ai/anime.json";
import autoAi from "@/content/ai/auto.json";
import techAi from "@/content/ai/tech.json";
import mobileAi from "@/content/ai/mobile.json";
import lifeAi from "@/content/ai/life.json";
import codingAi from "@/content/ai/coding.json";
import historyAi from "@/content/ai/history.json";
import filmAi from "@/content/ai/film.json";
import scienceAi from "@/content/ai/science.json";
import literatureAi from "@/content/ai/literature.json";
import travelAi from "@/content/ai/travel.json";

import { fingerprintOf } from "./fingerprint";

type Entry = {
  id: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  type: "single" | "multi" | "judge";
  stem: string;
  options: string[];
  answer: string | string[];
  explanation: string;
  source?: { title: string; url?: string };
};

type File = { domain: DomainId; questions: Entry[] };

/** 已审核入库的 AI 题：磁盘上多 batchId / reviewedAt / variantOf。 */
type AiEntry = Entry & {
  id: string;
  batchId: string;
  reviewedAt: string;
  variantOf?: string;
};
type AiFile = { domain: DomainId; questions: AiEntry[] };

function hydrate(
  domain: DomainId,
  file: File | AiFile,
  origin: Question["origin"] = "seed"
): Question[] {
  return (file?.questions ?? []).map((e) => ({
    ...e,
    domain,
    origin,
    fingerprint: fingerprintOf(e.stem),
  }));
}

const BANKS: Record<DomainId, Question[]> = {
  gaming: hydrate("gaming", gaming as unknown as File),
  anime: hydrate("anime", anime as unknown as File),
  auto: hydrate("auto", auto as unknown as File),
  tech: hydrate("tech", tech as unknown as File),
  mobile: hydrate("mobile", mobile as unknown as File),
  life: hydrate("life", life as unknown as File),
  coding: hydrate("coding", coding as unknown as File),
  history: hydrate("history", history as unknown as File),
  film: hydrate("film", film as unknown as File),
  science: hydrate("science", science as unknown as File),
  literature: hydrate("literature", literature as unknown as File),
  travel: hydrate("travel", travel as unknown as File),
};

/** 已审核入库的 AI 题（按域）。 */
const AI_BANKS: Record<DomainId, Question[]> = {
  gaming: hydrate("gaming", gamingAi as unknown as AiFile, "ai"),
  anime: hydrate("anime", animeAi as unknown as AiFile, "ai"),
  auto: hydrate("auto", autoAi as unknown as AiFile, "ai"),
  tech: hydrate("tech", techAi as unknown as AiFile, "ai"),
  mobile: hydrate("mobile", mobileAi as unknown as AiFile, "ai"),
  life: hydrate("life", lifeAi as unknown as AiFile, "ai"),
  coding: hydrate("coding", codingAi as unknown as AiFile, "ai"),
  history: hydrate("history", historyAi as unknown as AiFile, "ai"),
  film: hydrate("film", filmAi as unknown as AiFile, "ai"),
  science: hydrate("science", scienceAi as unknown as AiFile, "ai"),
  literature: hydrate("literature", literatureAi as unknown as AiFile, "ai"),
  travel: hydrate("travel", travelAi as unknown as AiFile, "ai"),
};

/** 某领域的全部题目（含答案）。 */
export function domainBank(domain: DomainId): Question[] {
  return BANKS[domain] ?? [];
}

/** 某领域的已审核 AI 题（含答案）。 */
export function aiBank(domain: DomainId): Question[] {
  return AI_BANKS[domain] ?? [];
}

/** 多个领域的题池（仅 seed —— duel 与每日挑战使用）。 */
export function bankPool(domains: readonly DomainId[]): Partial<Record<DomainId, Question[]>> {
  const out: Partial<Record<DomainId, Question[]>> = {};
  for (const d of domains) {
    const bank = BANKS[d];
    if (bank && bank.length > 0) out[d] = bank;
  }
  return out;
}

/** 多个领域的已审核 AI 题池。 */
export function aiPool(domains: readonly DomainId[]): Partial<Record<DomainId, Question[]>> {
  const out: Partial<Record<DomainId, Question[]>> = {};
  for (const d of domains) {
    const bank = AI_BANKS[d];
    if (bank && bank.length > 0) out[d] = bank;
  }
  return out;
}

/** 按 id 查题（含答案）。 */
export function findQuestion(id: string): Question | undefined {
  for (const bank of Object.values(BANKS)) {
    const hit = bank.find((q) => q.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 按 id 查题（seed + 已审核 AI，含答案）。
 * 仅给脚本 / e2e 使用；duel 与每日挑战请继续用 seed-only 的 `findQuestion`。
 */
export function findAnyQuestion(id: string): Question | undefined {
  const seed = findQuestion(id);
  if (seed) return seed;
  for (const bank of Object.values(AI_BANKS)) {
    const hit = bank.find((q) => q.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** 全部题目（seed + 已审核 AI）的指纹集合（生成去重用）。 */
export function allFingerprints(): Set<string> {
  const set = new Set<string>();
  for (const bank of [...Object.values(BANKS), ...Object.values(AI_BANKS)]) {
    for (const q of bank) set.add(q.fingerprint);
  }
  return set;
}

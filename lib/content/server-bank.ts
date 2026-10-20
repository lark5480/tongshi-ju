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

function hydrate(domain: DomainId, file: File): Question[] {
  return (file?.questions ?? []).map((e) => ({
    ...e,
    domain,
    origin: "seed" as const,
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

/** 某领域的全部题目（含答案）。 */
export function domainBank(domain: DomainId): Question[] {
  return BANKS[domain] ?? [];
}

/** 多个领域的题池。 */
export function bankPool(domains: readonly DomainId[]): Partial<Record<DomainId, Question[]>> {
  const out: Partial<Record<DomainId, Question[]>> = {};
  for (const d of domains) {
    const bank = BANKS[d];
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

/** 全部题目的指纹集合（去重用）。 */
export function allFingerprints(): Set<string> {
  const set = new Set<string>();
  for (const bank of Object.values(BANKS)) {
    for (const q of bank) set.add(q.fingerprint);
  }
  return set;
}

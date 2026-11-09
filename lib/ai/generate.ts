/**
 * AI 出题生成 —— 生成逻辑的唯一入口（API 路由与审核 CLI 共用）。
 *
 * 只负责「prompt → provider → 10 步校验链」，不负责落盘：
 * - HTTP 入口在 `app/api/ai/generate/route.ts`；
 * - 本地运营入口在 `scripts/ai-review.ts` 的 `gen` 命令；
 * - 待审池 IO 在 `lib/ai/pending-io.ts`。
 *
 * 本模块只允许服务端 / 脚本 import（会读取 provider 密钥与全量题库）。
 */

import { nanoid } from "nanoid";

import { DOMAINS } from "@/content/domains";
import type { AiGenerateInput } from "@/content/domains/schema";
import type { DomainId, Question } from "@/types";
import { fingerprintOf } from "@/lib/content/fingerprint";
import { aiBank, allFingerprints, domainBank } from "@/lib/content/server-bank";
import { addToIndex, type DomainTokenIndex } from "./dedupe";
import type { AiProvider } from "./provider";
import { buildGeneratePrompt, buildVariantPrompt } from "./prompt";
import { validateAiBatch, type RejectedQuestion } from "./validate";

export interface GenerateBatchResult {
  readonly batchId: string;
  readonly domain: DomainId;
  readonly accepted: Question[];
  readonly rejected: RejectedQuestion[];
  readonly batchValid: boolean;
}

/** 调用方入参错误（未知领域 / topic 越界 / 变体原题不存在）→ HTTP 400。 */
export class GenerateInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerateInputError";
  }
}

/** 已有题库的指纹与 token 索引（seed + 已审核 AI；跨域指纹也参与全局查重）。 */
function buildKnownBanks(domain: DomainId): {
  knownFingerprints: Map<string, string>;
  tokenIndex: DomainTokenIndex;
} {
  const knownFingerprints = new Map<string, string>();
  const tokenIndex: DomainTokenIndex = new Map();

  for (const q of [...domainBank(domain), ...aiBank(domain)]) {
    knownFingerprints.set(q.fingerprint, q.id);
    addToIndex(tokenIndex, q);
  }
  // 其它领域只做全局指纹查重，不参与同域近似查重。
  for (const fp of allFingerprints()) {
    if (!knownFingerprints.has(fp)) knownFingerprints.set(fp, fp);
  }

  return { knownFingerprints, tokenIndex };
}

/**
 * 生成一批题并过校验链。
 *
 * 变体模式以**题库原题**为准（忽略调用方传来的 stem/answer）：
 * 既避免客户端伪造原题造成 prompt 注入，也保证变体题的参照物是权威数据。
 */
export async function generateBatch(
  input: AiGenerateInput,
  provider: AiProvider
): Promise<GenerateBatchResult> {
  const meta = DOMAINS.find((d) => d.id === input.domain);
  if (!meta) throw new GenerateInputError(`未知领域：${input.domain}`);

  let prompt: string;
  if (input.variantOf) {
    const original = [...domainBank(input.domain), ...aiBank(input.domain)].find(
      (q) => q.id === input.variantOf?.questionId
    );
    if (!original) {
      throw new GenerateInputError(`找不到变体原题：${input.variantOf.questionId}`);
    }
    prompt = buildVariantPrompt({
      domain: input.domain,
      domainName: meta.name,
      topic: original.topic,
      originalStem: original.stem,
      originalAnswer: original.answer,
      count: input.count,
    });
  } else {
    if (input.topic && !meta.topics.includes(input.topic)) {
      throw new GenerateInputError(`知识点「${input.topic}」不属于 ${input.domain}`);
    }
    prompt = buildGeneratePrompt({
      domain: input.domain,
      domainName: meta.name,
      topics: meta.topics,
      topic: input.topic,
      difficulty: input.difficulty,
      count: input.count,
    });
  }

  const raw = await provider.generate(prompt);
  const { knownFingerprints, tokenIndex } = buildKnownBanks(input.domain);
  const batchId = `ai-${Date.now().toString(36)}-${nanoid(6)}`;

  const result = validateAiBatch(raw, {
    domain: input.domain,
    knownFingerprints,
    tokenIndex,
    batchId,
    variantOf: input.variantOf?.questionId,
    makeId: (domain, stem) => `${domain}-ai-${fingerprintOf(stem)}`,
  });

  return {
    batchId,
    domain: input.domain,
    accepted: result.accepted,
    rejected: result.rejected,
    batchValid: result.batchValid,
  };
}

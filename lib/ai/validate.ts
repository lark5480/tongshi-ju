/**
 * AI 输出的 10 步校验链。
 *
 * **任一步失败即拒绝该题**，并计入批次失败率。绝不放行未经验证的题目。
 *
 *  1. JSON 可解析
 *  2. 字段齐全且类型正确（Zod）
 *  3. domain 存在且 topic 命中该域白名单（防串域）
 *  4. difficulty ∈ {1,2,3}
 *  5. answer 命中 options
 *  6. 答案唯一、题干无歧义句式
 *  7. 解析非空且长度达标
 *  8. 指纹去重（与全库比对）
 *  9. 近似去重（同域 Jaccard > 0.85）
 * 10. 敏感 / 违禁内容过滤
 *
 * 校验通过后的题目进入**待审池**（`status: 'pending'`），
 * 人工抽检后才可转入正式题库。AI 题**永不参与每日挑战**。
 */

import { z } from "zod";

import type { DomainId, Difficulty, Question } from "@/types";
import { isValidTopic, topicsOf } from "@/content/domains";
import { validateQuestionShape } from "@/lib/engine/answer";
import { fingerprintOf } from "@/lib/content/fingerprint";
import { firstBlockedTerm } from "@/lib/content/sensitive";

import { addToIndex, checkFingerprint, checkNearDuplicate, type DomainTokenIndex } from "./dedupe";

/** AI 输出的单题结构（尚未补齐 id / domain / fingerprint 等运行时字段）。 */
export const aiQuestionSchema = z.object({
  topic: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  type: z.enum(["single", "multi", "judge"]).default("single"),
  stem: z.string().min(4).max(300),
  options: z.array(z.string().min(1)).min(2).max(6),
  answer: z.union([z.string(), z.array(z.string())]),
  explanation: z.string().min(10).max(600),
});

export const aiBatchSchema = z.object({
  questions: z.array(aiQuestionSchema).min(1).max(30),
});

export type AiQuestionDraft = z.infer<typeof aiQuestionSchema>;

/** 校验失败的原因。 */
export type RejectReason =
  | "json_invalid"
  | "schema_invalid"
  | "domain_mismatch"
  | "topic_unknown"
  | "difficulty_invalid"
  | "answer_not_in_options"
  | "ambiguous_stem"
  | "explanation_too_short"
  | "duplicate_fingerprint"
  | "near_duplicate"
  | "sensitive_content";

export interface RejectedQuestion {
  stem: string;
  reason: RejectReason;
  detail: string;
}

export interface ValidationResult {
  accepted: Question[];
  rejected: RejectedQuestion[];
  /** 批次整体是否有效（JSON 与 schema 层面）。 */
  batchValid: boolean;
}

/** 易产生歧义的题干句式。 */
const AMBIGUOUS_PATTERNS = [
  "以上都对",
  "以上都正确",
  "以上均是",
  "以下都对",
  "以下都正确",
  "下列说法正确的是",
  "下列说法错误的是",
  "以下哪个不是",
  "以下哪项不是",
  "下列哪个不是",
  "下列哪项不是",
  "以下哪个不属于",
  "都包括",
];

/** 敏感 / 违禁内容：词表唯一来源在 `lib/content/sensitive.ts`，这里不另立一份。 */

export interface ValidateOptions {
  domain: DomainId;
  /** 该域已有题目的指纹集合（题 id 集合）。 */
  knownFingerprints: ReadonlyMap<string, string> | ReadonlySet<string>;
  /** 该域已有题目的 token 索引。 */
  tokenIndex: DomainTokenIndex;
  /** 题目 id 生成器（注入以便测试）。 */
  makeId: (domain: DomainId, stem: string) => string;
  /** 变体模式：记录原题 id。 */
  variantOf?: string;
  /** 批次 id。 */
  batchId: string;
}

/**
 * 对一批 AI 输出做完整校验。
 *
 * @param raw 模型返回的原始内容（字符串或已解析对象）
 */
export function validateAiBatch(raw: unknown, opts: ValidateOptions): ValidationResult {
  const rejected: RejectedQuestion[] = [];
  const accepted: Question[] = [];

  // ---- 步骤 1：JSON 可解析 ----
  let payload: unknown = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      return {
        accepted,
        rejected: [{ stem: raw.slice(0, 60), reason: "json_invalid", detail: "无法解析为 JSON" }],
        batchValid: false,
      };
    }
  }

  // ---- 步骤 2：字段齐全且类型正确 ----
  const parsed = aiBatchSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      accepted,
      rejected: [
        {
          stem: "",
          reason: "schema_invalid",
          detail: parsed.error.issues.map((i) => i.message).join("；"),
        },
      ],
      batchValid: false,
    };
  }

  const allowedTopics = topicsOf(opts.domain);

  // 批次内的重复也要能查出来 → 用**可变副本**累积已接受的题目。
  // `knownFingerprints` 可能是 Map（值是题 id）或 Set（只做存在性判断），
  // 用属性探测做收窄：Map 有 `get`，Set 没有。
  const knownFingerprints: Map<string, string> = new Map();
  if ("get" in opts.knownFingerprints) {
    for (const [fp, id] of opts.knownFingerprints) knownFingerprints.set(fp, id);
  } else {
    for (const fp of opts.knownFingerprints) knownFingerprints.set(fp, fp);
  }
  const tokenIndex: DomainTokenIndex = new Map(
    Array.from(opts.tokenIndex.entries()).map(([k, v]) => [k, [...v]])
  );

  for (const draft of parsed.data.questions) {
    const stem = draft.stem;

    // ---- 步骤 3：domain 与 topic 白名单 ----
    if (allowedTopics.length === 0) {
      rejected.push({ stem, reason: "domain_mismatch", detail: "该领域尚未配置知识点白名单" });
      continue;
    }
    if (!isValidTopic(opts.domain, draft.topic)) {
      rejected.push({
        stem,
        reason: "topic_unknown",
        detail: `知识点「${draft.topic}」不属于 ${opts.domain}；允许值：${allowedTopics.join("、")}`,
      });
      continue;
    }

    // ---- 步骤 4：难度 ----
    const difficulty: Difficulty = draft.difficulty;
    if (![1, 2, 3].includes(difficulty)) {
      rejected.push({ stem, reason: "difficulty_invalid", detail: `非法难度 ${difficulty}` });
      continue;
    }

    // ---- 步骤 5/6：答案命中选项 + 唯一性 ----
    const shapeErrors = validateQuestionShape({
      type: draft.type,
      options: draft.options,
      answer: draft.answer,
      explanation: draft.explanation,
    });
    const answerOutOfRange = shapeErrors.some((e) => e.includes("不在选项中"));
    if (answerOutOfRange) {
      rejected.push({ stem, reason: "answer_not_in_options", detail: shapeErrors.join("；") });
      continue;
    }

    // ---- 步骤 6：歧义句式 ----
    const ambiguous = AMBIGUOUS_PATTERNS.find((p) => stem.includes(p));
    if (ambiguous) {
      rejected.push({
        stem,
        reason: "ambiguous_stem",
        detail: `题干含歧义句式「${ambiguous}」`,
      });
      continue;
    }

    // ---- 步骤 7：解析长度 ----
    if (draft.explanation.trim().length < 15) {
      rejected.push({
        stem,
        reason: "explanation_too_short",
        detail: `解析仅 ${draft.explanation.trim().length} 字，要求 ≥15 字`,
      });
      continue;
    }

    // ---- 步骤 8：指纹去重 ----
    const fpVerdict = checkFingerprint(stem, knownFingerprints);
    if (fpVerdict.duplicate) {
      rejected.push({
        stem,
        reason: "duplicate_fingerprint",
        detail: `与已有题目重复（${fpVerdict.against ?? "指纹命中"}）`,
      });
      continue;
    }

    // ---- 步骤 9：近似去重 ----
    const nearVerdict = checkNearDuplicate(stem, opts.domain, tokenIndex);
    if (nearVerdict.duplicate) {
      rejected.push({
        stem,
        reason: "near_duplicate",
        detail: `与 ${nearVerdict.against} 相似度 ${(nearVerdict.similarity ?? 0).toFixed(3)}`,
      });
      continue;
    }

    // ---- 步骤 10：敏感内容（阻断级词表与人工题库共用一份）----
    const sensitive = firstBlockedTerm(stem, draft.explanation, ...draft.options);
    if (sensitive) {
      rejected.push({ stem, reason: "sensitive_content", detail: `命中敏感词「${sensitive}」` });
      continue;
    }

    const id = opts.makeId(opts.domain, stem);
    const question: Question = {
      id,
      domain: opts.domain,
      topic: draft.topic,
      difficulty,
      type: draft.type,
      stem: draft.stem,
      options: draft.options.map((o) => o.trim()),
      answer: draft.answer,
      explanation: draft.explanation.trim(),
      origin: "ai",
      batchId: opts.batchId,
      fingerprint: fingerprintOf(stem),
    };
    if (opts.variantOf) question.variantOf = opts.variantOf;
    accepted.push(question);

    // 立刻登记，供**后续题目**查重（批次内重复也要拦）
    knownFingerprints.set(question.fingerprint, question.id);
    addToIndex(tokenIndex, question);
  }

  return { accepted, rejected, batchValid: true };
}

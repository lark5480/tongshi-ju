/**
 * AI 待审池 —— 纯函数层（无 IO）。
 *
 * 职责：把「生成并过了 10 步校验链的题」变成「可以写进 content/ai/ 的磁盘题」。
 * 批准不是复制粘贴：**必须重新查重**（与 seed、已入库 AI、本批已批准题），
 * 任何冲突都拒绝，绝不覆盖已有题目。
 *
 * IO 在 `pending-io.ts`；命令行入口在 `scripts/ai-review.ts`。
 */

import { z } from "zod";

import {
  domainIds,
  questionTypes,
  type AiDomainFile,
  type AiQuestionFileEntry,
} from "@/content/domains/schema";
import { isValidTopic, topicsOf } from "@/content/domains";
import type { DomainId, Question } from "@/types";
import { validateQuestionShape } from "@/lib/engine/answer";
import { fingerprintOf } from "@/lib/content/fingerprint";
import { firstBlockedTerm } from "@/lib/content/sensitive";

import { addToIndex, checkFingerprint, checkNearDuplicate, type DomainTokenIndex } from "./dedupe";

export const PENDING_STATUSES = ["pending", "approved", "rejected"] as const;
export type PendingStatus = (typeof PENDING_STATUSES)[number];

const pendingQuestionSchema = z.object({
  id: z.string().min(1),
  domain: z.enum(domainIds),
  topic: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  type: z.enum(questionTypes),
  stem: z.string().min(4),
  options: z.array(z.string().min(1)).min(2),
  answer: z.union([z.string(), z.array(z.string())]),
  explanation: z.string(),
  origin: z.enum(["seed", "ai"]),
  fingerprint: z.string().min(1),
  batchId: z.string().optional(),
  variantOf: z.string().optional(),
  source: z.object({ title: z.string().min(1), url: z.string().url().optional() }).optional(),
});

export const pendingBatchSchema = z.object({
  version: z.literal(1),
  batchId: z.string().regex(/^[A-Za-z0-9_-]+$/, "batchId 只能包含字母、数字、下划线和连字符"),
  domain: z.enum(domainIds),
  createdAt: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().optional(),
  input: z.object({
    domain: z.enum(domainIds),
    topic: z.string().optional(),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    count: z.number().int().min(1),
    variantOf: z.string().optional(),
  }),
  accepted: z.array(pendingQuestionSchema),
  rejected: z.array(
    z.object({
      stem: z.string(),
      reason: z.string(),
      detail: z.string(),
    })
  ),
  status: z.enum(PENDING_STATUSES),
  reviewedAt: z.string().optional(),
});

export type PendingBatch = z.infer<typeof pendingBatchSchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type PendingRejected = PendingBatch["rejected"][number];

export interface ApprovalInput {
  readonly batch: PendingBatch;
  /** 要批准的 accepted 题 id；缺省表示全部。 */
  readonly ids?: readonly string[];
  /** 当前同域 seed 题（用于查重与 id 冲突）。 */
  readonly seedQuestions: readonly Question[];
  /** 当前同域已入库 AI 题（用于查重与 id 冲突）。 */
  readonly aiQuestions: readonly Question[];
  /** 审核日期 YYYY-MM-DD（由调用方传入，纯函数不读时钟）。 */
  readonly reviewedAt: string;
}

export interface ApprovalResult {
  readonly ok: boolean;
  /** 可直接追加到 content/ai/<domain>.json 的磁盘题。 */
  readonly questions: AiQuestionFileEntry[];
  readonly errors: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AI_ID_RE = /^[a-z]+-ai-[0-9a-f]{8}$/;

function selectAccepted(
  batch: PendingBatch,
  ids: readonly string[] | undefined,
  errors: string[]
): PendingQuestion[] {
  if (!ids) return batch.accepted;
  const wanted = new Set(ids);
  const selected = batch.accepted.filter((q) => wanted.has(q.id));
  for (const id of wanted) {
    if (!batch.accepted.some((q) => q.id === id)) errors.push(`批次里没有题目 ${id}`);
  }
  if (selected.length === 0) errors.push("没有选中任何题目");
  return selected;
}

/**
 * 批准一批题：重新查重、生成稳定 id、转成磁盘形态。
 *
 * 任何一题失败都不会产出部分结果（`ok: false` 时 `questions` 为空），
 * 避免「批了一半、文件里多几道少几道」的脏状态。
 */
export function approveQuestions(input: ApprovalInput): ApprovalResult {
  const { batch, seedQuestions, aiQuestions, reviewedAt } = input;
  const errors: string[] = [];

  if (!DATE_RE.test(reviewedAt)) {
    errors.push(`reviewedAt 必须是 YYYY-MM-DD：${reviewedAt}`);
  }

  const selected = selectAccepted(batch, input.ids, errors);
  if (selected.length === 0) {
    return { ok: false, questions: [], errors };
  }

  const domain = batch.domain;
  const knownFingerprints = new Map<string, string>();
  const tokenIndex: DomainTokenIndex = new Map();
  const existingIds = new Set<string>();

  for (const q of [...seedQuestions, ...aiQuestions]) {
    knownFingerprints.set(q.fingerprint || fingerprintOf(q.stem), q.id);
    existingIds.add(q.id);
    addToIndex(tokenIndex, q);
  }

  const approved: AiQuestionFileEntry[] = [];

  for (const q of selected) {
    if (q.origin !== "ai") {
      errors.push(`${q.id}: origin 必须是 ai，拒绝把 seed 题混入 AI 题池`);
      continue;
    }
    if (q.domain !== domain) {
      errors.push(`${q.id}: 题目领域 ${q.domain} 与批次领域 ${domain} 不一致`);
      continue;
    }
    if (!isValidTopic(domain, q.topic)) {
      errors.push(
        `${q.id}: topic「${q.topic}」不在 ${domain} 白名单（允许：${topicsOf(domain).join("、")}）`
      );
      continue;
    }

    const shapeErrors = validateQuestionShape({
      type: q.type,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation,
    });
    if (shapeErrors.length > 0) {
      errors.push(`${q.id}: ${shapeErrors.join("；")}`);
      continue;
    }

    const sensitive = firstBlockedTerm(q.stem, q.explanation, q.topic, ...q.options);
    if (sensitive) {
      errors.push(`${q.id}: 命中阻断级内容安全词「${sensitive}」`);
      continue;
    }

    const fingerprint = fingerprintOf(q.stem);
    const id = `${domain}-ai-${fingerprint}`;
    if (!AI_ID_RE.test(id)) {
      errors.push(`${q.id}: 生成的 id ${id} 形态不合法`);
      continue;
    }
    if (existingIds.has(id)) {
      errors.push(`${id}: id 已存在，不覆盖`);
      continue;
    }

    const fpVerdict = checkFingerprint(q.stem, knownFingerprints);
    if (fpVerdict.duplicate) {
      errors.push(`${q.id}: 与 ${fpVerdict.against ?? "已有题目"} 题干重复`);
      continue;
    }

    const nearVerdict = checkNearDuplicate(q.stem, domain, tokenIndex);
    if (nearVerdict.duplicate) {
      errors.push(
        `${q.id}: 与 ${nearVerdict.against ?? "已有题目"} 高度相似（${(nearVerdict.similarity ?? 0).toFixed(3)}）`
      );
      continue;
    }

    const disk: AiQuestionFileEntry = {
      id,
      topic: q.topic,
      difficulty: q.difficulty,
      type: q.type,
      stem: q.stem.trim(),
      options: q.options.map((o) => o.trim()),
      answer: q.answer,
      explanation: q.explanation.trim(),
      batchId: batch.batchId,
      reviewedAt,
      ...(q.variantOf ? { variantOf: q.variantOf } : {}),
      ...(q.source ? { source: q.source } : {}),
    };

    approved.push(disk);
    existingIds.add(id);
    knownFingerprints.set(fingerprint, id);
    addToIndex(tokenIndex, { ...q, id, fingerprint });
  }

  if (errors.length > 0) {
    return { ok: false, questions: [], errors };
  }

  approved.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, questions: approved, errors: [] };
}

/**
 * 把批准后的题合并进磁盘文件（纯函数）。
 *
 * id 冲突直接报错，不覆盖；输出按 id 排序，保证 diff 稳定。
 */
export function mergeApproved(
  file: AiDomainFile,
  questions: readonly AiQuestionFileEntry[]
): { file: AiDomainFile; errors: string[] } {
  const errors: string[] = [];
  const existing = new Set(file.questions.map((q) => q.id));
  for (const q of questions) {
    if (existing.has(q.id)) errors.push(`${q.id}: id 已存在，不覆盖`);
  }
  if (errors.length > 0) return { file, errors };
  return {
    file: {
      domain: file.domain,
      questions: [...file.questions, ...questions].sort((a, b) => a.id.localeCompare(b.id)),
    },
    errors: [],
  };
}

/** 批次的 accepted 是否还有可批准项（CLI 列表用）。 */
export function approvableCount(batch: PendingBatch): number {
  return batch.status === "pending" ? batch.accepted.length : 0;
}

/** 把 accepted 题按 id 建索引（CLI show 用）。 */
export function indexAccepted(batch: PendingBatch): Map<string, PendingQuestion> {
  return new Map(batch.accepted.map((q) => [q.id, q]));
}

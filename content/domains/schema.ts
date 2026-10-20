/**
 * 题库 schema —— 用 Zod 统一描述「一道合法题目」长什么样。
 *
 * 该 schema 是三方共用的唯一裁判：
 * - `scripts/validate-content.ts` 用它校验 12 个题库文件（CI 必跑）；
 * - `lib/ai/validate.ts` 用它校验 AI 生成的题目（校验链第 2 步）。
 *
 * ## 磁盘格式与运行时格式的差别（重要）
 *
 * 磁盘上的 `content/domains/<domain>.json` 采用**紧凑格式**：
 * ```json
 * { "domain": "gaming", "questions": [ { "id": "...", "topic": "...", ... } ] }
 * ```
 * 三个字段**不在磁盘上**：
 * - `domain` —— 由文件名/文件级字段决定，加载时注入；
 * - `origin` —— 磁盘上的题一律是 `seed`；`ai` 题存放在待审池，加载时注入；
 * - `fingerprint` —— 由题干归一化后哈希**在加载时计算**。
 *
 * 这样做的收益：作者改题干时不可能忘记同步指纹（因为根本没有手写指纹），
 * 也消除了「指纹与题干不一致」的脏数据类别。
 */

import { z } from "zod";

export const domainIds = [
  "gaming",
  "anime",
  "auto",
  "tech",
  "mobile",
  "life",
  "coding",
  "history",
  "film",
  "science",
  "literature",
  "travel",
] as const;

export const questionTypes = ["single", "multi", "judge"] as const;

/** 磁盘上的单题（不含 domain / origin / fingerprint）。 */
export const questionSchema = z
  .object({
    id: z.string().regex(/^[a-z]+-\d{4}$/, "id 必须形如 gaming-0007"),
    topic: z.string().min(1, "topic 不能为空"),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    type: z.enum(questionTypes),
    stem: z.string().min(4, "题干过短").max(300, "题干过长"),
    options: z.array(z.string().min(1)).min(2, "至少 2 个选项").max(6, "最多 6 个选项"),
    answer: z.union([z.string(), z.array(z.string())]),
    explanation: z.string().min(10, "解析至少 10 字").max(600, "解析过长"),
    source: z.object({ title: z.string().min(1), url: z.string().url().optional() }).optional(),
  })
  .strict();

/** 磁盘上的一个域文件。 */
export const domainFileSchema = z.object({
  domain: z.enum(domainIds),
  questions: z.array(questionSchema),
});

export type QuestionFileEntry = z.infer<typeof questionSchema>;
export type DomainFile = z.infer<typeof domainFileSchema>;

/** AI 出题请求的入参。 */
export const aiGenerateSchema = z.object({
  domain: z.enum(domainIds),
  topic: z.string().min(1).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  count: z.number().int().min(1).max(20).default(5),
  /** 变体模式：由原题生成同知识点的新题。 */
  variantOf: z
    .object({
      questionId: z.string().min(1),
      stem: z.string().min(4),
      answer: z.union([z.string(), z.array(z.string())]),
    })
    .optional(),
});

export type AiGenerateInput = z.infer<typeof aiGenerateSchema>;

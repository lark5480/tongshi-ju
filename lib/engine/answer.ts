/**
 * 答案归一化与判定。
 *
 * P0 只支持 `single` / `multi` / `judge` 三种题型（见 types/index.ts）：
 * - `single`：提交值与正确答案归一化后相等即算对；
 * - `judge`：同上，选项固定为 `["正确", "错误"]`；
 * - `multi`：**全对才得分**，少选、多选、错选都算错。
 *
 * 归一化规则（去空白 / 去标点 / 全角转半角 / 英文小写）让「正确答案里多一个空格」
 * 这类差异不会造成误判；同时 multi 的答案比较是**集合相等**，与选项顺序无关。
 */

import type { Question, QuestionType } from "@/types";

/** 全角字符 → 半角。 */
function toHalfWidth(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 去掉所有空白与常见标点，转小写。 */
export function normalizeAnswer(input: string): string {
  return toHalfWidth(input)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：""''（）【】《》…—·,.!?;:"'()[\]{}<>~`@#$%^&*_+=|\\/]/g, "");
}

/** 答案数组归一化 + 去重 + 字典序排序（保证比较与存储稳定）。 */
export function normalizeAnswerList(answers: readonly string[]): string[] {
  return Array.from(new Set(answers.map(normalizeAnswer))).sort();
}

/** 规范化「提交值」为字符串数组（单值也走同一路径）。 */
export function toAnswerArray(answer: string | string[]): string[] {
  return Array.isArray(answer) ? answer : [answer];
}

/** 判定提交答案是否正确。 */
export function isCorrect(
  type: QuestionType,
  correctAnswer: string | string[],
  submitted: string | string[]
): boolean {
  if (type === "multi") {
    const want = normalizeAnswerList(toAnswerArray(correctAnswer));
    const got = normalizeAnswerList(toAnswerArray(submitted));
    if (want.length === 0 || want.length !== got.length) return false;
    return want.every((v, i) => v === got[i]);
  }
  const want = normalizeAnswer(toAnswerArray(correctAnswer)[0] ?? "");
  const got = normalizeAnswer(toAnswerArray(submitted)[0] ?? "");
  return want.length > 0 && want === got;
}

/**
 * 把答案规范化为**入库形态**：
 * - `multi`：数组、去重、**按原始字符串字典序**排序（保证文件中的存储形态稳定）；
 * - 其他：单个字符串（从数组取第一项）。
 *
 * 注意：比较时用的是 `normalizeAnswerList`（归一化后排序），与这里的**存储形态**
 * 是两套顺序 —— 因为归一化会去掉标点空格，理论上可能改变相对次序。
 */
export function canonicalAnswer(type: QuestionType, answer: string | string[]): string | string[] {
  if (type === "multi") {
    const uniq = Array.from(new Set(toAnswerArray(answer)));
    return uniq.sort();
  }
  return toAnswerArray(answer)[0] ?? "";
}

/** 题目是否合法（答案命中选项、选项无重复、解析非空）。用于题库校验与 AI 校验链。 */
export function validateQuestionShape(q: {
  type: QuestionType;
  options: string[];
  answer: string | string[];
  explanation: string;
}): string[] {
  const errors: string[] = [];

  const opts = q.options.map((o) => o.trim()).filter(Boolean);
  if (q.type === "judge") {
    if (opts.length !== 2) errors.push("判断题必须有且只有 2 个选项");
  } else if (opts.length < 2) {
    errors.push("选项少于 2 个");
  }
  const optSet = new Set(opts);
  if (optSet.size !== opts.length) errors.push("选项存在重复");

  const answers = toAnswerArray(q.answer);
  if (answers.length === 0) errors.push("答案为空");
  for (const a of answers) {
    if (!optSet.has(a.trim())) errors.push(`答案「${a}」不在选项中`);
  }
  if (q.type === "multi") {
    // 多选题：答案必须是选项的非空真子集，且至少 2 个（否则与单选无异）
    if (answers.length > opts.length) errors.push("多选题答案数量超过选项数量");
    if (answers.length < 2) errors.push("多选题答案至少应有 2 个");
    if (new Set(answers.map((a) => a.trim())).size !== answers.length) {
      errors.push("多选题答案存在重复");
    }
  } else if (answers.length !== 1) {
    errors.push("单选/判断题答案必须唯一");
  }

  if (!q.explanation || q.explanation.trim().length < 5) errors.push("解析缺失或过短");
  return errors;
}

/**
 * 选项展示顺序 —— 与抽题分离的确定性洗牌。
 *
 * 题库里正确答案大量落在第一个选项，不能靠人工维护位置。
 * 这里用「局种子 + question.id」派生独立 PRNG：
 * - 不消耗抽题 PRNG，因此不会改变选中的题目；
 * - 同一题 + 同一 seed 在客户端、服务端、PK 双方得到同一顺序；
 * - 返回新对象，不修改题池。
 */

import type { Question } from "@/types";
import { hashSeed, mulberry32, shuffled } from "./prng";

export function shuffleOptions(question: Question, seed: number): Question {
  if (question.options.length <= 1) return question;
  const rng = mulberry32(hashSeed("options:" + seed + ":" + question.id));
  return { ...question, options: shuffled(question.options, rng) };
}

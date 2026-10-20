/**
 * 出题与变体 prompt 构造。
 *
 * prompt 的目标是**让模型产出可被机械校验的结构**：
 * - 严格 JSON（schema 固定）；
 * - 题干不含歧义句式；
 * - 解析具体、有知识量（这是产品的核心价值，不能敷衍）。
 */

import type { DomainId, Difficulty } from "@/types";

export interface GeneratePromptParams {
  domain: DomainId;
  domainName: string;
  topics: string[];
  topic?: string;
  difficulty?: Difficulty;
  count: number;
}

/** 出题 prompt。 */
export function buildGeneratePrompt(p: GeneratePromptParams): string {
  const topicLine = p.topic
    ? `知识点必须严格限定为：「${p.topic}」`
    : `知识点必须从以下清单中选取其一：${p.topics.join("、")}`;
  const diffLine = p.difficulty ? `难度固定为 ${p.difficulty} 级。` : "难度在 1/2/3 中自行分配。";

  return `你是一名知识竞赛出题专家。请为「${p.domainName}」领域出 ${p.count} 道**单项选择题**。

要求：
1. ${topicLine}
2. ${diffLine}难度 1=常识、2=进阶、3=专业。
3. 每题 4 个选项，**只有一个正确答案**。干扰项要看起来合理但明确错误。
4. 题干**禁止**出现「以下哪个不是」「下列说法正确的是」「以上都对」「以下都正确」等易产生歧义的句式。
5. 题干不得在题干中直接透露答案。
6. 解析必须具体说明**为什么**是这个答案，附带知识点背景，不少于 30 个字。
7. 事实必须准确可靠，宁可选择广泛公认的基础常识。

严格按以下 JSON 结构输出，不要输出任何其他文字或 markdown 代码块：
{
  "questions": [
    {
      "topic": "知识点名称",
      "difficulty": 1,
      "stem": "题干",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "选项A",
      "explanation": "解析，不少于 30 字"
    }
  ]
}`;
}

/** 变体题 prompt：由原题生成同知识点、不同问法的新题。 */
export function buildVariantPrompt(params: {
  domain: DomainId;
  domainName: string;
  topic: string;
  originalStem: string;
  originalAnswer: string | string[];
  count: number;
}): string {
  const answerText = Array.isArray(params.originalAnswer)
    ? params.originalAnswer.join("、")
    : params.originalAnswer;

  return `你是一名知识竞赛出题专家。请基于下面这道原题，在**同一个知识点**上出一道**问法不同**的新题（变体题）。

原题题干：${params.originalStem}
原题正确答案：${answerText}
知识点：${params.topic}
领域：${params.domainName}

要求：
1. 新题的问法、切入点必须与原题明显不同（例如换一个角度提问、反问、条件变化等），但**考查的是同一个知识点**。
2. 新题仍然是 4 个选项的单项选择题，只有一个正确答案。
3. **新题的正确答案必须与原题答案等价**（如果原题是数值型，数值必须相同；如果是结论型，结论必须一致）。
4. 题干禁止出现「以下哪个不是」「以上都对」等歧义句式。
5. 解析要说明本题与原题是同一知识点的不同问法，不少于 30 个字。

请输出 ${params.count} 道变体题，严格按以下 JSON 结构输出，不要输出其他文字或 markdown 代码块：
{
  "questions": [
    {
      "topic": "知识点名称",
      "difficulty": 1,
      "stem": "变体题的题干",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answer": "选项A",
      "explanation": "解析，不少于 30 字"
    }
  ]
}`;
}

/**
 * 内容安全词表 —— 人工题库与 AI 题库共用的**唯一一份**。
 *
 * ## 为什么分两级
 *
 * | 级别 | 含义 | 谁裁定 |
 * |---|---|---|
 * | `block` | 明确违法违规的表述（暴恐制毒、赌博、色情、种族灭绝…） | 机器可以直接判死 |
 * | `review` | 涉及时政、领土、民族、宗教的**评价性句式** | **只提示，人来判** |
 *
 * 自动化的边界是观测不是判断：一道写「某地属于哪国」的事实题可能是合规的，
 * 一道写「某地主权存在争议」的题才是要命的。所以 `review` 一律不阻断，
 * 命中就打印出来让人去看一眼 —— 别指望词表替人做结论。
 *
 * ## 加词的铁律：中文没有词边界
 *
 * 短词会被普通词组吞掉。实测教训：`台独` 命中过
 * 「第一部在流媒体**平台独**家发行的剧集」这种完全正常的选项。
 *
 * 所以新增条目必须同时满足：
 * 1. 语义明确（优先 4 字以上的长短语，不用裸地名、不用裸双字）；
 * 2. **全库实测 0 误伤** —— 加完跑 `npm run validate:content`，
 *    若把现有 500+ 道题打下来，说明这条词不能这么写，换一个更长的说法或直接放弃。
 *
 * 单测 `__tests__/content.sensitive.test.ts` 会把第 2 条钉住。
 */

/** 阻断级：命中即不允许入库。 */
export const SENSITIVE_BLOCK_PATTERNS: readonly string[] = [
  // 暴恐与武器
  "杀人",
  "自制炸药",
  "自制枪支",
  "血腥暴力的描述",
  // 毒品
  "自杀方法",
  "制毒",
  "贩毒",
  "毒品交易",
  "冰毒",
  "大麻种植",
  // 赌博
  "赌博网站",
  // 色情（含未成年人，红线中的红线）
  "裸体",
  "情色",
  "儿童色情",
  // 极端政治与仇恨
  "种族灭绝",
  "种族主义",
  "纳粹",
];

/** 警示级：命中只提示人工复核，不阻断。 */
export const SENSITIVE_REVIEW_PATTERNS: readonly string[] = [
  "主权争议",
  "领土争议",
  "有争议的地区",
  "独立公投",
  "民族优劣",
  "邪教",
  "敏感事件",
  "政治斗争",
  "领导人评价",
];

export type SensitiveLevel = "block" | "review";

export interface SensitiveHit {
  level: SensitiveLevel;
  term: string;
}

/**
 * 扫描一段文本。返回全部命中（同一条词只记一次）。
 *
 * 调用方自己决定级别怎么用：AI 校验链只取 `block`（第 10 步敏感词），
 * 题库校验脚本两级都用 —— `block` 报错、`review` 打警告。
 */
export function scanSensitive(...texts: readonly string[]): SensitiveHit[] {
  const hay = texts.join(" ");
  const hits: SensitiveHit[] = [];
  for (const term of SENSITIVE_BLOCK_PATTERNS) {
    if (hay.includes(term)) hits.push({ level: "block", term });
  }
  for (const term of SENSITIVE_REVIEW_PATTERNS) {
    if (hay.includes(term)) hits.push({ level: "review", term });
  }
  return hits;
}

/** AI 校验链用的旧口径：只看阻断级，返回命中的第一个词。 */
export function firstBlockedTerm(...texts: readonly string[]): string | undefined {
  return scanSensitive(...texts).find((h) => h.level === "block")?.term;
}

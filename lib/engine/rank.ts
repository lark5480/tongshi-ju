/**
 * 通识段位 —— 把「每天玩一下」变成一条看得见的长期成长线。
 *
 * ## 为什么要有段位
 *
 * 每日挑战的反馈是**单局**的：今天多少分、几颗星。缺一个**跨天累积**的成长刻度，
 * 玩家感知不到"我比上个月强"。段位就是这个刻度。
 *
 * ## 关键约束：无状态
 *
 * 段位完全由**本地**数据算出（战绩历史 + 熟练度 + 连胜），不依赖任何服务端状态。
 * 因此：
 * - 与每日挑战的无状态架构一致，云轨照样能随便扩容；
 * - 换浏览器就归零（与错题本、战绩同规则，见 AGENTS.md 已知限制）。
 *
 * 本模块是**纯函数**：输入一份快照，输出一份段位报告，无 IO、无时间依赖。
 * 「现在几点」这类判断由调用方（storage 层）负责。
 */

import type { DomainId } from "@/types";

/** 段位定义。阈值按「一个认真玩的中位玩家」的节奏标定。 */
export interface RankTier {
  /** 0 起的段位序号。 */
  index: number;
  /** 段位名。 */
  name: string;
  /** 进入该段位所需的最低通识值。 */
  threshold: number;
  /** 该段位的一句话描述（结算页/首页展示）。 */
  blurb: string;
}

/**
 * 六段阶梯。
 *
 * 阈值节奏（按每天 5 题、约 4 题答对估算）：
 * 见习 → 入门 ≈ 2 天；→ 通识 ≈ 8 天；→ 博闻 ≈ 3 周；→ 渊博 ≈ 1.5 月；→ 睿哲 ≈ 3 月。
 */
export const RANK_TIERS: readonly RankTier[] = [
  { index: 0, name: "见习", threshold: 0, blurb: "刚进门，路还没认熟" },
  { index: 1, name: "入门", threshold: 150, blurb: "开始上道了" },
  { index: 2, name: "通识", threshold: 600, blurb: "像个通识玩家了" },
  { index: 3, name: "博闻", threshold: 1500, blurb: "朋友愿意跟你聊" },
  { index: 4, name: "渊博", threshold: 3200, blurb: "话题覆盖半个互联网" },
  { index: 5, name: "睿哲", threshold: 6000, blurb: "身边人的知识百科" },
];

/** 计算段位所需的全部输入 —— 全部来自本地存储。 */
export interface RankInput {
  /** 历史累计答对题数。 */
  totalCorrect: number;
  /** 历史累计完成局数。 */
  totalPlayed: number;
  /** 历史累计获得的星级总和。 */
  totalStars: number;
  /** 触及过的知识点数量（`domain|topic` 的去重个数）。 */
  topicsTouched: number;
  /** 历史最高连击。 */
  bestCombo: number;
  /** 最长连续天数。 */
  bestStreak: number;
}

/** 段位报告。 */
export interface RankSnapshot {
  /** 当前段位序号（0 起的索引）。 */
  tier: number;
  /** 当前段位名。 */
  tierName: string;
  /** 当前段位的一句话描述。 */
  tierBlurb: string;
  /** 当前通识值。 */
  value: number;
  /** 下一段的门槛；已满级为 null。 */
  nextThreshold: number | null;
  /** 距离下一段还差多少；已满级为 0。 */
  nextGap: number;
  /** 到下一段的进度（0-1）；已满级为 1。 */
  progress: number;
  /** 是否已满级。 */
  maxed: boolean;
}

/** 各项权重。改这里等于改整个成长曲线的形状。 */
export const RANK_WEIGHTS = {
  /** 每答对一题。 */
  correct: 3,
  /** 每完成一局。 */
  played: 4,
  /** 每颗星。 */
  star: 6,
  /** 每个新知识点。 */
  topic: 2,
  /** 每点最高连击。 */
  combo: 5,
  /** 每天连续打卡。 */
  streakDay: 2,
} as const;

/** 通识值 = 各维度加权求和。 */
export function rankValue(input: RankInput): number {
  const w = RANK_WEIGHTS;
  return (
    Math.max(0, input.totalCorrect) * w.correct +
    Math.max(0, input.totalPlayed) * w.played +
    Math.max(0, input.totalStars) * w.star +
    Math.max(0, input.topicsTouched) * w.topic +
    Math.max(0, input.bestCombo) * w.combo +
    Math.max(0, input.bestStreak) * w.streakDay
  );
}

/**
 * 由通识值推出段位报告。
 *
 * 纯函数：同样的输入永远得到同样的输出。
 * 已满级时 `nextThreshold` 为 null、`progress` 为 1。
 */
export function computeRank(input: RankInput): RankSnapshot {
  const value = rankValue(input);
  const maxed = value >= RANK_TIERS[RANK_TIERS.length - 1].threshold;

  let tier = 0;
  for (const t of RANK_TIERS) {
    if (value >= t.threshold) tier = t.index;
  }

  const current = RANK_TIERS[tier];
  const next = maxed ? null : RANK_TIERS[tier + 1];

  const nextThreshold = next ? next.threshold : null;
  const nextGap = next ? Math.max(0, next.threshold - value) : 0;
  const span = next ? next.threshold - current.threshold : 1;
  const progress = next ? Math.max(0, Math.min(1, (value - current.threshold) / span)) : 1;

  return {
    tier,
    tierName: current.name,
    tierBlurb: current.blurb,
    value,
    nextThreshold,
    nextGap,
    progress,
    maxed,
  };
}

/**
 * 段位的中文展示名（含序号感），如「通识 · 叁 段」。
 * 纯展示逻辑，单独抽出来便于测试与复用。
 */
export function rankDisplayName(snapshot: RankSnapshot): string {
  return `${snapshot.tierName}`;
}

/** 段位徽章的描述性副标题。 */
export function rankSubtitle(snapshot: RankSnapshot): string {
  if (snapshot.maxed) return `${snapshot.tierName} · 已达最高段位`;
  return `${snapshot.tierName} · 距${RANK_TIERS[snapshot.tier + 1].name}还差 ${snapshot.nextGap}`;
}

/** 从熟练度表（`domain|topic` -> 数值）统计触及过的知识点数。 */
export function countTopicsTouched(mastery: Record<string, number>): number {
  let n = 0;
  for (const [key, value] of Object.entries(mastery)) {
    if (!key.includes("|")) continue;
    // 熟练度会被 recordMastery 压到 >= 0，但历史数据可能残留负值
    if (value !== 0) n += 1;
  }
  return n;
}

/** 从历史记录统计累计答对题数 / 完成局数 / 星级总和 / 最高连击。 */
export interface HistoryTotals {
  totalCorrect: number;
  totalPlayed: number;
  totalStars: number;
  bestCombo: number;
}

/** 汇总历史战绩。纯函数。 */
export function totalsFromHistory(
  history: readonly {
    correct: number;
    stars: number;
    maxCombo: number;
  }[]
): HistoryTotals {
  let totalCorrect = 0;
  let totalPlayed = 0;
  let totalStars = 0;
  let bestCombo = 0;
  for (const h of history) {
    totalCorrect += h.correct;
    totalPlayed += 1;
    totalStars += h.stars;
    if (h.maxCombo > bestCombo) bestCombo = h.maxCombo;
  }
  return { totalCorrect, totalPlayed, totalStars, bestCombo };
}

/** 便于测试与展示：把领域 id 集合排序后拼成稳定键。 */
export function domainSetKey(domains: readonly DomainId[]): string {
  return [...domains].sort().join("+");
}

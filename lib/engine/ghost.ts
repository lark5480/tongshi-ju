/**
 * 影子对手 —— 「和昨天的自己同场竞速」。
 *
 * ## 这是什么
 *
 * 每日挑战是**无状态**的：同一天同领域组合，全网拿到同一份题。
 * 正因为无状态，我们没有服务端排行榜 —— 但也因此可以做一个**零服务端成本**的对手：
 *
 * > **你过去的自己。**
 *
 * 同一组领域下，系统记住你上一次（或历史最好）的成绩，作为"影子"。
 * 答题时影子与你的分数**同步推进**，结束后告诉你：赢了、差多少、还是超了多少。
 *
 * ## 为什么这个机制值得做
 *
 * 竞品普遍用 **排行榜 + 段位**做长期钩子，但排行榜需要服务端、需要账号、需要反作弊。
 * 本项目没有账号体系（见 docs/ARCHITECTURE.md §9 已知限制），排行榜做不出来也不该做。
 *
 * 影子对手用**本地数据**替代了排行榜的心理功能：
 * - 它比排行榜**更贴人** —— 你追赶的不是陌生人，是自己的昨天；
 * - 它**完全公平** —— 对手就是你自己，没有任何 cheating 空间；
 * - 它**零成本** —— 不增加任何服务端状态，双轨部署架构不受影响。
 *
 * 本模块是纯函数：比较逻辑与文案生成都不碰 IO。
 */

/** 影子的领域集合键（由 `ghostKey` 生成）。 */
export type GhostKey = string;

/** 一条影子记录 —— 某组领域下"过去的自己"。 */
export interface GhostRecord {
  /** 领域集合的规范键。 */
  key: GhostKey;
  /** 历史最高总分。 */
  bestScore: number;
  /** 历史最高答对题数。 */
  bestCorrect: number;
  /** 达到最佳成绩的日期（`YYYY-MM-DD`）。 */
  bestDate: string;
  /** 这组领域下完成的局数。 */
  plays: number;
  /** 历史最佳总用时（毫秒），用于"比上次快"；无数据时为 null。 */
  bestElapsed: number | null;
}

/**
 * 影子键 = 领域集合的**规范序**拼接。
 *
 * 与 `lib/engine/daily.ts` 的 `canonicalDomains` 同理：领域是**集合**不是列表，
 * 用户按不同顺序点选的是同一组领域，影子必须跟着"同一组"走，
 * 否则用户会觉得"我明明选了同样的领域，怎么对手变了"。
 */
export function ghostKey(domains: readonly string[]): GhostKey {
  return [...domains].sort().join("+");
}

/** 影子对比的结果类型。 */
export type GhostVerdictKind =
  /** 第一次挑战，还没有影子可追。 */
  | "first"
  /** 追平了影子。 */
  | "tied"
  /** 超过了影子。 */
  | "beat"
  /** 差一点点（差距在 10% 以内）。 */
  | "near"
  /** 落后较多。 */
  | "behind";

/** 影子对比结论。 */
export interface GhostVerdict {
  kind: GhostVerdictKind;
  /** 与影子的分差（正数 = 领先）。 */
  delta: number;
  /** 影子的历史最佳分。 */
  ghostScore: number;
  /** 影子的成绩日期。 */
  ghostDate: string | null;
}

/** 判定「接近」的阈值：差距 ≤ 影子分的 10%。 */
export const GHOST_NEAR_RATIO = 0.1;

/**
 * 把本次成绩与影子对比。
 *
 * @param score      本次总分
 * @param ghost      影子记录；null 表示这是第一次挑战
 * @param tieValue   判定"追平"的分差容差（默认 0，即必须严格大于才算 beat）
 */
export function compareWithGhost(
  score: number,
  ghost: GhostRecord | null,
  tieValue = 0
): GhostVerdict {
  if (!ghost) {
    return { kind: "first", delta: 0, ghostScore: 0, ghostDate: null };
  }

  const delta = score - ghost.bestScore;

  if (delta > tieValue) {
    return { kind: "beat", delta, ghostScore: ghost.bestScore, ghostDate: ghost.bestDate };
  }
  if (delta === tieValue) {
    return { kind: "tied", delta: 0, ghostScore: ghost.bestScore, ghostDate: ghost.bestDate };
  }

  const gap = -delta;
  const nearThreshold = Math.max(1, ghost.bestScore * GHOST_NEAR_RATIO);
  const kind: GhostVerdictKind = gap <= nearThreshold ? "near" : "behind";
  return { kind, delta, ghostScore: ghost.bestScore, ghostDate: ghost.bestDate };
}

/**
 * 影子结论的中文文案。
 *
 * 语气克制：陈述事实，不喊口号（见 docs/design/ui-system.md §5 文案规范）。
 */
export function ghostVerdictText(verdict: GhostVerdict): string {
  switch (verdict.kind) {
    case "first":
      return "第一次挑战 —— 今天的成绩就是明天的影子";
    case "tied":
      return "追平了自己的影子";
    case "beat":
      return `超过过去的自己 ${verdict.delta} 分`;
    case "near":
      return `差 ${Math.abs(verdict.delta)} 分就追平影子`;
    case "behind":
      return `落后影子 ${Math.abs(verdict.delta)} 分`;
  }
}

/** 影子的简短标签，用于「影子来自哪天」。 */
export function ghostSourceLabel(verdict: GhostVerdict): string {
  if (!verdict.ghostDate) return "影子：尚未成形";
  return `影子：${verdict.ghostDate} 的你`;
}

/**
 * 用本次成绩更新影子记录。
 *
 * 规则：
 * - 分数更高 → 刷新最佳成绩与日期；
 * - 分数相同但**更快** → 刷新最佳用时（用于"比上次快"）；
 * - 局数 +1。
 *
 * 纯函数：返回新记录，不修改入参。
 */
export function updateGhost(
  ghost: GhostRecord | null,
  next: {
    key: GhostKey;
    score: number;
    correct: number;
    date: string;
    elapsed: number | null;
  }
): GhostRecord {
  if (!ghost) {
    return {
      key: next.key,
      bestScore: next.score,
      bestCorrect: next.correct,
      bestDate: next.date,
      plays: 1,
      bestElapsed: next.elapsed,
    };
  }

  const better = next.score > ghost.bestScore;
  const sameScoreFaster =
    next.score === ghost.bestScore &&
    next.elapsed !== null &&
    (ghost.bestElapsed === null || next.elapsed < ghost.bestElapsed);

  return {
    key: ghost.key,
    bestScore: better ? next.score : ghost.bestScore,
    bestCorrect: better ? next.correct : ghost.bestCorrect,
    bestDate: better ? next.date : ghost.bestDate,
    plays: ghost.plays + 1,
    bestElapsed: better ? next.elapsed : sameScoreFaster ? next.elapsed : ghost.bestElapsed,
  };
}

/**
 * 影子的"进度条"推进值 —— 答题过程中让影子与玩家同步前进。
 *
 * 用**累计得分**做线性映射：影子最终分 = bestScore，当前影子得分 = 已完成题目的累计分上限。
 * 这里返回 0-1 的比例，供 UI 画两条并行的进度条。
 */
export function ghostProgress(
  ghost: GhostRecord | null,
  playerScore: number,
  maxScore: number
): number {
  if (!ghost || maxScore <= 0) return 0;
  const ratio = playerScore / maxScore;
  const ghostRatio = ghost.bestScore / maxScore;
  // 影子进度 = 玩家进度与影子进度中，影子"已到达"的位置
  return Math.max(0, Math.min(1, Math.min(ratio, ghostRatio)));
}

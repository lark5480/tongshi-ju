/**
 * 盲盒轮转 —— 「1 个本命 + 2 个每日盲盒」。
 *
 * ## 要解决的问题
 *
 * 每日挑战原本是"选 1-3 个本命领域，之后每天都是它们"。
 * 好处是稳定，坏处是**玩家会把自己锁进舒适区**：
 * 选游戏和动漫的人，半年后只会这两块 —— 而"通识"这个词也就名不副实了。
 *
 * 盲盒模式给出第三条路：
 * - 你只固定 **1 个本命**（你真正想长期深入的领域）；
 * - 另外 **2 个由日期种子决定**，当天全网一致，**明天换新**。
 *
 * 于是每天都有"意料之外的那一题"，同时不牺牲本命。
 *
 * ## 与架构的关系
 *
 * 盲盒领域由 `hashSeed("blindbox:" + dateKey)` 决定，**纯函数、跨用户一致**：
 * - 当天所有开盲盒的玩家抽到的是**同一批**盲盒领域；
 * - 不需要任何服务端状态，与每日挑战的无状态架构完全兼容；
 * - 换领域组合会改变每日题目种子，这是**预期行为**（题集本来就是 f(日期, 领域集合)）。
 *
 * 本模块是纯函数，无 IO、无时间依赖。
 */

import type { DomainId } from "@/types";
import { hashSeed } from "./prng";
import { canonicalDomains, pickDomainsBySeed } from "./daily";

/** 每日挑战的三种领域模式。 */
export type DailyMode = "native" | "blindbox" | "random";

/** 盲盒领域数量的默认值（总题数 5 题时的节奏）。 */
export const DEFAULT_BLINDBOX_COUNT = 2;

/**
 * 当日盲盒领域。
 *
 * **与用户无关**：同一天，同一份候选池 → 同一批盲盒领域。
 * 这样"全网同题"在盲盒模式下依然成立。
 */
export function blindboxDomains(
  dateKey: string,
  candidates: readonly DomainId[],
  count = DEFAULT_BLINDBOX_COUNT
): DomainId[] {
  if (candidates.length === 0) return [];
  return pickDomainsBySeed(hashSeed(`blindbox:${dateKey}`), candidates, count);
}

/** 解析每日挑战的领域集合所需的参数。 */
export interface ResolveDomainsParams {
  /** `YYYY-MM-DD`（Asia/Shanghai）。 */
  dateKey: string;
  /** 玩家选定的本命领域（1-3 个）。 */
  native: readonly DomainId[];
  /** 是否开启盲盒轮转。 */
  blindbox: boolean;
  /** 候选领域池（通常是所有已上线领域）。 */
  candidates: readonly DomainId[];
  /** 随机模式下的领域数量。 */
  randomCount?: number;
}

/**
 * 解析当日的**实际**领域集合。
 *
 * 三种模式：
 * - `native`：用玩家选的本命领域；
 * - `blindbox`：本命第 1 个 + 当日盲盒领域（盲盒从候选池里剔除本命，避免重复）；
 * - `random`：完全按日期种子从候选池取（"随缘开局"）。
 *
 * 返回值始终是**去重后排序**的规范序 —— 领域是集合，与点选顺序无关。
 */
export function resolveDailyDomains(params: ResolveDomainsParams): DomainId[] {
  const { dateKey, native, blindbox, candidates } = params;

  if (blindbox) {
    const anchor = native[0];
    if (!anchor) {
      // 没有本命可锚定时退化为纯随机（等价于"随缘"）
      return pickDomainsBySeed(
        hashSeed(`random-domains:${dateKey}`),
        candidates,
        params.randomCount ?? 3
      );
    }
    const pool = candidates.filter((d) => d !== anchor);
    const blind = blindboxDomains(dateKey, pool, DEFAULT_BLINDBOX_COUNT);
    return canonicalDomains([anchor, ...blind]);
  }

  if (native.length > 0) return canonicalDomains(native);

  return pickDomainsBySeed(
    hashSeed(`random-domains:${dateKey}`),
    candidates,
    params.randomCount ?? 3
  );
}

/** 模式的中文名（用于界面标签）。 */
export function dailyModeLabel(mode: DailyMode): string {
  switch (mode) {
    case "native":
      return "本命模式";
    case "blindbox":
      return "盲盒轮转";
    case "random":
      return "随缘开局";
  }
}

/** 模式的一句话说明（用于界面提示）。 */
export function dailyModeHint(mode: DailyMode): string {
  switch (mode) {
    case "native":
      return "每天挑战你选定的领域，题目稳定不变";
    case "blindbox":
      return "1 个本命 + 2 个每日盲盒，强制跨域";
    case "random":
      return "每天由日期决定 3 个领域，全网同题";
  }
}

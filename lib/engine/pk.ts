/**
 * 同题 PK 码 —— 把「全网同题」这一架构优势变成社交货币。
 *
 * ## 要解决的问题
 *
 * 每日挑战已经做到「同一天同领域组合，全网同一份题」。但这个优势**只被用来做排行榜的底座**，
 * 而排行榜需要服务端、需要账号、需要反作弊 —— 本项目一个都没有。
 *
 * 于是我们换一个用法：**同题 PK 码**。
 *
 * - 两人约定一个 4–6 位的码（今天还有���个「今日推荐码」，所有人默认相同）；
 * - 两人各自打开 App，输入同一个码，**各自本地跑同一份纯函数**；
 * - 结果：**两人拿到完全相同的 5 道题、同样的顺序、同样的难度曲线**；
 * - 各自作答、各自计时、各自算分，最后互相比较。
 *
 * ## 为什么这能成立
 *
 * 题集本来就是纯函数 `f(seed, domains, count)`，而 `buildDailySet` **本来就支持传入显式 seed**
 * （duel 已在用）。PK 只是把 seed 的来源从「房间 seed」换成「日期 + 码」的哈希：
 *
 * ```
 * pkSeed(dateKey, code) = hashSeed("pk:" + dateKey + ":" + code)
 * pkDomains(dateKey, code, pool) = pickDomainsBySeed(hashSeed("pk-domains:" + dateKey + ":" + code), pool, 3)
 * ```
 *
 * 于是 **同一���、同一个码 → 同一组领域 + 同一份题**，且**不需要任何服务端**。
 *
 * ## 与「每日挑战」的关系
 *
 * PK 是**独立模式**，不共用每日挑战的题集（seed 不同），也不影响 streak 与段位。
 * 它复用同一套计分与连击公式 —— 这正是"同一份题才可比"的前提。
 *
 * 本模块是纯函数，无 IO、无时间依赖。
 */

import type { DomainId } from "@/types";
import { hashSeed } from "./prng";
import { pickDomainsBySeed } from "./daily";

/** PK 码的字母表 —— 排除易混字符 `I / O / 0 / 1`。 */
export const PK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** PK 码最小长度。 */
export const PK_CODE_MIN = 4;
/** PK 码最大长度。 */
export const PK_CODE_MAX = 6;

const CODE_RE = /^[A-HJ-NP-Z2-9]{4,6}$/;

/** 规范化：转大写并剔除所有非字母数字字符。 */
export function normalizePkCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** 校验 PK 码格式（4–6 位，排除易混字符）。 */
export function isValidPkCode(code: string): boolean {
  return CODE_RE.test(normalizePkCode(code));
}

/**
 * 由种子生成一个 PK 码。
 *
 * 用自实现的 LCG 展开 —— 项目红线是「随机全部自实现」，不引依赖。
 * 注意：这里**不是**密码学随机，PK 码本来就不是秘密，它只是"约定"。
 */
export function codeFromSeed(seed: number, length = PK_CODE_MIN): string {
  let s = seed >>> 0;
  let out = "";
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out += PK_ALPHABET[s % PK_ALPHABET.length];
  }
  return out;
}

/**
 * 今日推荐码 —— **所有人当天默认相同**。
 *
 * 这样两个人不用事先约码，打开就能同题；
 * 需要多开几局或与不同的人玩时，再手动输入对方的自定义码。
 */
export function dailyPkCode(dateKey: string): string {
  return codeFromSeed(hashSeed(`pk-code:${dateKey}`));
}

/** PK 局面的种子：同一天 + 同一个码 → 同一个种子。 */
export function pkSeed(dateKey: string, code: string): number {
  return hashSeed(`pk:${dateKey}:${normalizePkCode(code)}`);
}

/**
 * PK 局面的领域集合。
 *
 * **由码决定，与玩家档案无关** —— 这是两人题目一致的前提。
 */
export function pkDomains(
  dateKey: string,
  code: string,
  candidates: readonly DomainId[],
  count = 3
): DomainId[] {
  if (candidates.length === 0) return [];
  return pickDomainsBySeed(
    hashSeed(`pk-domains:${dateKey}:${normalizePkCode(code)}`),
    candidates,
    count
  );
}

/** 一场 PK 的完整规格 —— 双方各自本地算出，**必须完全一致**。 */
export interface PkSpec {
  /** 规范化后的 PK 码。 */
  code: string;
  /** `YYYY-MM-DD`（Asia/Shanghai）。 */
  dateKey: string;
  /** 领域集合。 */
  domains: DomainId[];
  /** 题目种子。 */
  seed: number;
}

/**
 * 由「日期 + 码」推出 PK 规格。
 *
 * 纯函数：同样的输入永远得到同样的输出 —— 这就是"同题"的全部秘密。
 */
export function resolvePkSpec(
  dateKey: string,
  code: string,
  candidates: readonly DomainId[],
  count = 3
): PkSpec {
  const normalized = normalizePkCode(code);
  return {
    code: normalized,
    dateKey,
    domains: pkDomains(dateKey, normalized, candidates, count),
    seed: pkSeed(dateKey, normalized),
  };
}

/** PK 码的展示说明（用于界面提示）。 */
export function pkCodeHint(code: string): string {
  return `${normalizePkCode(code)} · 今天用这个码的人，题目完全相同`;
}

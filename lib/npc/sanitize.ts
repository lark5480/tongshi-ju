/**
 * NPC 输入/输出清洗 —— 纯函数。
 *
 * 两个目的：
 * 1. **输入**：`episode.topic` 来自客户端，会进入 prompt。只允许命中该域白名单的 topic，
 *    未知域名 / topic 直接丢弃该条记忆，避免把任意文本塞进模型提示词。
 * 2. **输出**：模型台词也要过内容安全与长度检查；命中就降级到确定性模板，
 *    并且降级原因要能区分「安全过滤」和「调用失败」，不能混成一句。
 */

import { DOMAINS, isValidTopic } from "@/content/domains";
import { firstBlockedTerm } from "@/lib/content/sensitive";
import type { DomainId } from "@/types";

import type { NpcEpisode } from "./types";

const CONTROL_RE = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/** 模型输出被拒的类型（由 narrate 映射成玩家可读的降级原因）。 */
export type NpcOutputErrorCode = "empty" | "blocked" | "injection" | "too_long";

export class NpcOutputError extends Error {
  readonly code: NpcOutputErrorCode;

  constructor(code: NpcOutputErrorCode, message: string) {
    super(message);
    this.name = "NpcOutputError";
    this.code = code;
  }
}

function cleanText(text: string): string {
  return text.replace(CONTROL_RE, " ").replace(/\s+/g, " ").trim();
}

/** 只保留合法领域，顺序不变。 */
export function sanitizeDomains(domains: readonly string[]): DomainId[] {
  return domains.filter((d): d is DomainId => DOMAINS.some((meta) => meta.id === d));
}

/**
 * 清洗情景记忆：非法域名 / 不在白名单的 topic 直接丢弃。
 *
 * 丢弃而不是改写：记忆是「模型可参考的证据」，宁可少一条，也不要把不可信文本
 * 换成一句看似合理的假记忆。
 */
export function sanitizeEpisodes(episodes: readonly NpcEpisode[]): NpcEpisode[] {
  const out: NpcEpisode[] = [];
  for (const episode of episodes) {
    if (!DOMAINS.some((meta) => meta.id === episode.domain)) continue;
    const topic = cleanText(episode.topic).slice(0, 32);
    if (!topic || !isValidTopic(episode.domain, topic)) continue;
    out.push({ ...episode, topic });
  }
  return out;
}

/** 记忆理由：单行、限长、命中阻断词时退回通用描述。 */
export function sanitizeMemory(reason: string): string {
  const clean = cleanText(reason).slice(0, 80);
  if (!clean || firstBlockedTerm(clean)) return "最近的一次作答";
  return clean;
}

/** 疑似提示注入的文本特征（只用于输出，输入已在 topic 白名单处拦截）。 */
const INJECTION_RE =
  /(忽略(?:以上|之前|上述)(?:的)?(?:指令|提示|要求)|系统提示|ignore\s+(?:all\s+)?previous)/i;

/**
 * 清洗模型台词/周报。
 *
 * 顺序：去控制符 → 空检查 → 敏感词 → 注入特征 → 长度。
 * 任一失败抛 `NpcOutputError`，由 `narrate` 回落模板并给出明确原因。
 */
export function sanitizeCommentary(text: string, maxChars = 80): string {
  const clean = cleanText(text);
  if (!clean) throw new NpcOutputError("empty", "模型输出为空");

  const blocked = firstBlockedTerm(clean);
  if (blocked) throw new NpcOutputError("blocked", `命中敏感词「${blocked}」`);

  if (INJECTION_RE.test(clean)) {
    throw new NpcOutputError("injection", "包含疑似提示注入文本");
  }

  const length = Array.from(clean).length;
  if (length > maxChars) {
    throw new NpcOutputError("too_long", `输出 ${length} 字，上限 ${maxChars}`);
  }

  return clean;
}

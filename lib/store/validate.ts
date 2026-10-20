/**
 * 写接口的入参校验 —— 统一用 Zod，杜绝脏数据进入房间状态。
 *
 * 昵称：长度限制 + 字符白名单（防 XSS 与超长输入）。
 * 领域：必须是 12 个合法 id 之一，数量 0-3（0 = 随缘，服务端按种子随机）。
 */

import { z } from "zod";

import { domainIds } from "@/content/domains/schema";

/** 昵称：1-12 个字符，允许中英文数字与常见符号。 */
export const playerNameSchema = z
  .string()
  .trim()
  .min(1, "昵称不能为空")
  .max(12, "昵称最多 12 个字符")
  .regex(/^[\u4e00-\u9fa5A-Za-z0-9_·\- ]+$/, "昵称包含不允许的字符");

/** 头像 emoji：1-4 个字符的单个 emoji。 */
export const playerEmojiSchema = z
  .string()
  .trim()
  .min(1, "请选择一个头像")
  .max(8, "头像过长")
  .regex(
    /^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF} ]+$/u,
    "头像必须是单个 emoji"
  );

/** 领域数组：0-3 个合法领域 id。 */
export const domainsSchema = z
  .array(z.enum(domainIds))
  .max(3, "最多选择 3 个领域")
  .transform((arr) => Array.from(new Set(arr)));

/** 创建房间。 */
export const createRoomSchema = z.object({
  name: playerNameSchema,
  emoji: playerEmojiSchema,
  domains: domainsSchema.default([]),
});

/** 加入房间。 */
export const joinRoomSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NP-Z2-9]{4,8}$/, "房间码格式不正确"),
  name: playerNameSchema,
  emoji: playerEmojiSchema,
});

/** 准备 / 取消准备。 */
export const readySchema = z.object({
  playerId: z.string().min(1, "缺少玩家凭证"),
  ready: z.boolean(),
});

/** 开局。 */
export const startSchema = z.object({
  playerId: z.string().min(1, "缺少玩家凭证"),
});

/** 提交答案。 */
export const answerSchema = z.object({
  playerId: z.string().min(1, "缺少玩家凭证"),
  roundIndex: z.number().int().min(0),
  answer: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
});

/** 再来一局。 */
export const rematchSchema = z.object({
  playerId: z.string().min(1, "缺少玩家凭证"),
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  SENSITIVE_BLOCK_PATTERNS,
  SENSITIVE_REVIEW_PATTERNS,
  firstBlockedTerm,
  scanSensitive,
} from "../lib/content/sensitive";

/**
 * 内容安全词表的不变量。
 *
 * 重点不是"某个词能不能命中"，而是**词表不能击穿现有题库** ——
 * 中文没有词边界，短词会被普通词组吞掉（`台独` 命中过「流媒体**平台独**家发行」），
 * 那样的门一上就是永久红灯，维护者只会把它关掉。
 */

const CONTENT_DIR = join(process.cwd(), "content", "domains");

const bank = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => {
    const parsed = JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf-8")) as {
      domain: string;
      questions: {
        stem: string;
        explanation: string;
        topic: string;
        options: string[];
        id: string;
      }[];
    };
    return parsed.questions.map((q) => ({ ...q, domain: parsed.domain }));
  });

test("词表条目去重且不留裸单字", () => {
  const all = [...SENSITIVE_BLOCK_PATTERNS, ...SENSITIVE_REVIEW_PATTERNS];
  assert.equal(new Set(all).size, all.length, "同一条词不应同时出现在两级或重复登记");
  for (const term of all) assert.ok(term.length >= 2, `条目过短必误伤：${term}`);
});

test("两级词表互不相交（同一词只能有一个裁定级别）", () => {
  const block = new Set(SENSITIVE_BLOCK_PATTERNS);
  for (const term of SENSITIVE_REVIEW_PATTERNS) assert.ok(!block.has(term), `级别冲突：${term}`);
});

test("现有题库不被词表击穿（0 阻断、0 警示）", () => {
  assert.ok(bank.length > 0, "题库没读到，这条断言就失去意义");
  const offenders = bank.filter(
    (q) => scanSensitive(q.stem, q.explanation, q.topic, ...q.options).length > 0
  );
  assert.deepEqual(
    offenders.map((q) => `${q.domain}/${q.id}`),
    [],
    "新增词表条目必须先做到不误伤现有题目，否则换成更长的说法"
  );
});

test("阻断级能命中明显违规文本，警示级不误判为阻断", () => {
  assert.equal(firstBlockedTerm("这道题教你怎么制毒和贩毒"), "制毒");
  const reviewOnly = scanSensitive("关于该地主权争议的说法很多");
  assert.deepEqual(
    reviewOnly.map((h) => h.level),
    ["review"]
  );
  assert.equal(firstBlockedTerm("关于该地主权争议的说法很多"), undefined);
});

test("AI 校验链与题库脚本共用同一份词表（不再各存一份）", () => {
  // 断言的是「单一真相源」：validate.ts 里不该再出现私有词表数组。
  const src = readFileSync(join(process.cwd(), "lib/ai/validate.ts"), "utf-8");
  assert.ok(!/const SENSITIVE_PATTERNS/.test(src), "AI 链不得再维护第二份敏感词表");
  assert.ok(src.includes("firstBlockedTerm"), "AI 链的第 10 步应走共用词表");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NEAR_DUP_THRESHOLD,
  addToIndex,
  checkFingerprint,
  checkNearDuplicate,
} from "../lib/ai/dedupe";
import { fingerprintOf, jaccard, normalizeStem, tokenize } from "../lib/content/fingerprint";
import type { DomainTokenIndex } from "../lib/ai/dedupe";

test("指纹：相同题干得到相同指纹", () => {
  assert.equal(fingerprintOf("题干内容"), fingerprintOf("题干内容"));
  assert.equal(fingerprintOf("题干内容").length, 8);
});

test("指纹：忽略空格、标点与全半角差异", () => {
  assert.equal(fingerprintOf("你好，世界"), fingerprintOf("你好世界"));
  assert.equal(fingerprintOf("ＡＢＣ"), fingerprintOf("abc"));
});

test("指纹：不同题干得到不同指纹", () => {
  assert.notEqual(fingerprintOf("题干一"), fingerprintOf("题干二"));
});

test("checkFingerprint 命中 Map 中的既有题", () => {
  const known = new Map([[fingerprintOf("已有题目"), "gaming-0001"]]);
  const hit = checkFingerprint("已有题目", known);
  assert.equal(hit.duplicate, true);
  assert.equal(hit.against, "gaming-0001");

  const miss = checkFingerprint("全新题目", known);
  assert.equal(miss.duplicate, false);
});

test("checkFingerprint 支持 Set 形式", () => {
  const known = new Set([fingerprintOf("已有题目")]);
  assert.equal(checkFingerprint("已有题目", known).duplicate, true);
  assert.equal(checkFingerprint("全新题目", known).duplicate, false);
});

test("归一化：去掉空白与标点", () => {
  assert.equal(normalizeStem(" 你好，世界！ "), "你好世界");
});

test("分词：中文按 2-gram、英文按连续片段", () => {
  const tokens = tokenize("游戏 abc");
  assert.ok(tokens.has("游戏"));
  assert.ok(tokens.has("abc"));
});

test("Jaccard：相同集合为 1，完全不同为 0", () => {
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  assert.equal(jaccard(new Set(["a"]), new Set(["b"])), 0);
  assert.equal(jaccard(new Set(), new Set()), 1);
});

test("近似查重：高度相似判为重复", () => {
  const index: DomainTokenIndex = new Map();
  addToIndex(index, {
    id: "gaming-0001",
    domain: "gaming",
    topic: "经典作品",
    difficulty: 1,
    type: "single",
    stem: "下列哪款游戏由宫崎骏所在的吉卜力工作室制作？",
    options: ["A", "B", "C", "D"],
    answer: "A",
    explanation: "解析",
    origin: "seed",
    fingerprint: "00000000",
  });

  const verdict = checkNearDuplicate(
    "下列哪款游戏由宫崎骏所在的吉卜力工作室制作呢",
    "gaming",
    index
  );
  assert.equal(verdict.duplicate, true);
  assert.equal(verdict.against, "gaming-0001");
  assert.ok((verdict.similarity ?? 0) > NEAR_DUP_THRESHOLD);
});

test("近似查重：不同领域不互相影响", () => {
  const index: DomainTokenIndex = new Map();
  addToIndex(index, {
    id: "gaming-0001",
    domain: "gaming",
    topic: "经典作品",
    difficulty: 1,
    type: "single",
    stem: "下列哪款游戏由宫崎骏所在的吉卜力工作室制作？",
    options: ["A", "B", "C", "D"],
    answer: "A",
    explanation: "解析",
    origin: "seed",
    fingerprint: "00000000",
  });

  const verdict = checkNearDuplicate("下列哪款游戏由宫崎骏所在的吉卜力工作室制作呢", "tech", index);
  assert.equal(verdict.duplicate, false, "不同域不应判定为重复");
});

test("近似查重：空索引不误判", () => {
  const verdict = checkNearDuplicate("任意题干", "gaming", new Map());
  assert.equal(verdict.duplicate, false);
});

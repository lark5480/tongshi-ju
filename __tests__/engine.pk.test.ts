import { test } from "node:test";
import assert from "node:assert/strict";

import type { DomainId } from "../types";
import {
  PK_ALPHABET,
  PK_CODE_MAX,
  PK_CODE_MIN,
  codeFromSeed,
  dailyPkCode,
  isValidPkCode,
  normalizePkCode,
  pkDomains,
  pkSeed,
  resolvePkSpec,
} from "../lib/engine/pk";

const ALL: DomainId[] = [
  "gaming",
  "anime",
  "tech",
  "coding",
  "life",
  "history",
  "auto",
  "mobile",
  "film",
  "science",
  "literature",
  "travel",
];

test("PK 码规范化：转大写并剔除非字母数字", () => {
  assert.equal(normalizePkCode("k7qm"), "K7QM");
  assert.equal(normalizePkCode(" k7-qm "), "K7QM");
  assert.equal(normalizePkCode("K7QM!!!"), "K7QM");
});

test("PK 码校验：4–6 位，排除易混字符 I/O/0/1", () => {
  assert.equal(isValidPkCode("K7QM"), true);
  assert.equal(isValidPkCode("K7"), false);
  assert.equal(isValidPkCode("K7QMABCD"), false);
  // 长度恰好在边界上
  assert.equal(isValidPkCode("ABCD"), true);
  assert.equal(isValidPkCode("ABCDEF"), true);
  assert.equal(isValidPkCode("ABCDEFG"), false);
  // 易混字符
  assert.equal(isValidPkCode("K7I0"), false);
  assert.equal(isValidPkCode("K7O1"), false);
  assert.equal(PK_CODE_MIN, 4);
  assert.equal(PK_CODE_MAX, 6);
});

test("PK 码字母表不含易混字符", () => {
  for (const ch of "IO01") {
    assert.ok(!PK_ALPHABET.includes(ch), `字母表不应包含 ${ch}`);
  }
});

test("由种子生成 PK 码：确定性", () => {
  assert.equal(codeFromSeed(12345), codeFromSeed(12345));
  assert.equal(codeFromSeed(12345).length, PK_CODE_MIN);
});

test("今日推荐码：同一天全网一致，不同日期不同", () => {
  assert.equal(dailyPkCode("2026-10-20"), dailyPkCode("2026-10-20"));
  assert.ok(isValidPkCode(dailyPkCode("2026-10-20")));

  const codes = new Set(
    Array.from({ length: 12 }, (_, i) => dailyPkCode(`2026-10-${String(i + 1).padStart(2, "0")}`))
  );
  assert.ok(codes.size > 1, "不同日期应给出不同的推荐码");
});

test("PK 种子：同一天同一个码 → 同一个种子；换码即换种子", () => {
  assert.equal(pkSeed("2026-10-20", "K7QM"), pkSeed("2026-10-20", "K7QM"));
  assert.equal(pkSeed("2026-10-20", "k7qm"), pkSeed("2026-10-20", "K7QM"), "码应先规范化");
  assert.notEqual(pkSeed("2026-10-20", "K7QM"), pkSeed("2026-10-20", "ABCD"));
  assert.notEqual(pkSeed("2026-10-20", "K7QM"), pkSeed("2026-10-21", "K7QM"));
});

test("PK 领域：同一天同一个码 → 完全一致（这是「同题」的前提）", () => {
  const a = pkDomains("2026-10-20", "K7QM", ALL, 3);
  const b = pkDomains("2026-10-20", "K7QM", ALL, 3);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
  assert.ok(a.every((d) => ALL.includes(d)));
});

test("PK 领域：换码会换题（不同码 → 不同领域组合）", () => {
  const seen = new Set(
    ["K7QM", "ABCD", "XYZW", "PQRS", "TUVW", "MNOP"].map((c) =>
      pkDomains("2026-10-20", c, ALL, 3).join("+")
    )
  );
  assert.ok(seen.size > 1, "不同码应给出不同的领域组合");
});

test("PK 领域：候选池为空时返回空数组", () => {
  assert.deepEqual(pkDomains("2026-10-20", "K7QM", [], 3), []);
});

test("PK 规格：同一天同一个码 → 两端算出完全一致的规格", () => {
  const a = resolvePkSpec("2026-10-20", "K7QM", ALL, 3);
  const b = resolvePkSpec("2026-10-20", "k7qm", ALL, 3);
  assert.deepEqual(a, b);
  assert.equal(a.code, "K7QM");
  assert.equal(a.dateKey, "2026-10-20");
  assert.equal(a.domains.length, 3);
  assert.equal(typeof a.seed, "number");
});

test("PK 规格：换码或换日期 → 规格不同", () => {
  const base = resolvePkSpec("2026-10-20", "K7QM", ALL, 3);
  const other = resolvePkSpec("2026-10-20", "ABCD", ALL, 3);
  const later = resolvePkSpec("2026-10-21", "K7QM", ALL, 3);
  assert.notEqual(base.seed, other.seed);
  assert.notEqual(base.seed, later.seed);
});

test("PK 领域：结果恒为规范序（升序）", () => {
  const domains = pkDomains("2026-10-20", "K7QM", ALL, 3);
  assert.deepEqual(domains, [...domains].sort());
});

test("PK 领域：候选池新增领域后题目会变（这是预期行为）", () => {
  const before = pkDomains("2026-10-20", "K7QM", ALL, 3);
  const after = pkDomains("2026-10-20", "K7QM", [...ALL, "extra" as DomainId], 3);
  // 洗牌依赖候选池的**顺序与内容**，所以扩池后组合可能变化 —— 这是设计如此
  assert.ok(Array.isArray(after));
  assert.equal(after.length, 3);
  assert.notDeepEqual(before, after);
});

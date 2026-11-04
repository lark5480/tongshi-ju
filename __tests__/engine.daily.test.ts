import { test } from "node:test";
import assert from "node:assert/strict";

import type { DomainId, Question } from "../types";
import {
  DEFAULT_DAILY_COUNT,
  buildDailySet,
  canonicalDomains,
  dailySeed,
  difficultyCurve,
  pickDomainsBySeed,
  pickRandomDomains,
} from "../lib/engine/daily";
import { shiftDay } from "../lib/engine/date";

/** 构造测试题池。 */
function makePool(domains: DomainId[], perDomain: number): Partial<Record<DomainId, Question[]>> {
  const pool: Partial<Record<DomainId, Question[]>> = {};
  for (const d of domains) {
    pool[d] = Array.from({ length: perDomain }, (_, i) => ({
      id: `${d}-${String(i).padStart(4, "0")}`,
      domain: d,
      topic: "T",
      difficulty: ((i % 3) + 1) as 1 | 2 | 3,
      type: "single" as const,
      stem: `题目 ${d} ${i}`,
      options: ["A", "B", "C", "D"],
      answer: "A",
      explanation: "解析",
      origin: "seed" as const,
      fingerprint: "00000000",
    }));
  }
  return pool;
}

const DOMS: DomainId[] = ["gaming", "tech", "life"];

test("同一天 + 同一组领域 → 同一份题集（确定性）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("不同日期 → 不同题集", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const b = buildDailySet({ dateKey: "2026-10-21", domains: DOMS, pool });
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("不同领域集合 → 不同题集", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "tech"], pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "life"], pool });
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("抽题不重复（题量充足时）", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const ids = picks.map((p) => p.question.id);
  assert.equal(new Set(ids).size, ids.length, "题集内不应出现重复题");
});

test("默认题数为 5", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  assert.equal(picks.length, DEFAULT_DAILY_COUNT);
});

test("每题都来自所选领域", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  for (const p of picks) {
    assert.ok(DOMS.includes(p.question.domain), `越界领域 ${p.question.domain}`);
  }
});

test("领域轮转覆盖：三个领域都至少出现一次", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const used = new Set(picks.map((p) => p.question.domain));
  assert.equal(used.size, DOMS.length, "应覆盖全部所选领域");
});

test("最后一题是彩蛋题，且与上一题不同域", () => {
  const pool = makePool(DOMS, 40);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const last = picks[picks.length - 1];
  const prev = picks[picks.length - 2];
  assert.equal(last.isEgg, true, "末题应标记为彩蛋题");
  assert.notEqual(last.question.domain, prev.question.domain, "彩蛋题应与上一题不同域");
});

test("显式 seed 优先于 dateKey（duel 用房间种子）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "x", domains: DOMS, pool, seed: 12345 });
  const b = buildDailySet({ dateKey: "y", domains: DOMS, pool, seed: 12345 });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
  const c = buildDailySet({ dateKey: "x", domains: DOMS, pool, seed: 999 });
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    c.map((p) => p.question.id)
  );
});

test("选项顺序确定，且答案仍在选项中", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });

  assert.deepEqual(
    a.map((p) => p.question.options),
    b.map((p) => p.question.options),
    "同一题集必须得到同一选项顺序"
  );
  for (const pick of a) {
    const answers = Array.isArray(pick.question.answer)
      ? pick.question.answer
      : [pick.question.answer];
    for (const answer of answers) {
      assert.ok(pick.question.options.includes(answer), `选项里找不到答案 ${answer}`);
    }
  }
});

test("选项会随种子变化：不会所有题永远把答案放首位", () => {
  const pool = makePool(DOMS, 40);
  let shifted = 0;

  for (let day = 1; day <= 30; day++) {
    const dateKey = `2026-11-${String(day).padStart(2, "0")}`;
    const picks = buildDailySet({ dateKey, domains: DOMS, pool });
    for (const pick of picks) {
      const answer = Array.isArray(pick.question.answer)
        ? pick.question.answer[0]
        : pick.question.answer;
      if (pick.question.options[0] !== answer) shifted++;
    }
  }

  assert.ok(shifted > 0, "选项顺序应随日期种子变化");
});

test("显式 seed 下选项顺序一致（duel / PK 共用）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "x", domains: DOMS, pool, seed: 12345 });
  const b = buildDailySet({ dateKey: "y", domains: DOMS, pool, seed: 12345 });

  assert.deepEqual(
    a.map((p) => p.question.options),
    b.map((p) => p.question.options),
    "同一 seed 必须得到同一选项顺序"
  );
});

test("allowedTypes 过滤题型：duel 可排除多选", () => {
  const pool = makePool(["gaming"], 12);
  const questions = pool.gaming ?? [];

  // 把前 8 题改成多选，确保两种题型都有足够候选
  for (let i = 0; i < 8; i++) {
    questions[i].type = "multi";
    questions[i].options = ["甲", "乙", "丙", "丁"];
    questions[i].answer = ["乙", "甲"];
  }

  const singles = buildDailySet({
    dateKey: "x",
    domains: ["gaming"],
    pool,
    count: 5,
    allowedTypes: ["single", "judge"],
  });
  const multis = buildDailySet({
    dateKey: "x",
    domains: ["gaming"],
    pool,
    count: 5,
    allowedTypes: ["multi"],
  });

  assert.equal(singles.length, 5);
  assert.ok(singles.every((p) => p.question.type !== "multi"));
  assert.equal(multis.length, 5);
  assert.ok(multis.every((p) => p.question.type === "multi"));
});

test("cycle：3 域各 60 题时，30 天内单题不重复", () => {
  const pool = makePool(DOMS, 60);
  const seen = new Set<string>();

  for (let i = 0; i < 30; i++) {
    const dateKey = shiftDay("2026-11-01", i);
    const picks = buildDailySet({
      dateKey,
      domains: DOMS,
      pool,
      schedule: "cycle",
    });
    for (const pick of picks) {
      assert.ok(!seen.has(pick.question.id), `第 ${i + 1} 天重复了 ${pick.question.id}`);
      seen.add(pick.question.id);
    }
  }

  assert.equal(seen.size, 150, "30 天应覆盖 150 道不同题");
});

test("cycle：一个周期内整池只出现一次，周期末尾才回到起点", () => {
  const pool = makePool(DOMS, 60);
  const seen = new Set<string>();
  let firstId = "";

  for (let i = 0; i < 36; i++) {
    const picks = buildDailySet({
      dateKey: shiftDay("2026-11-01", i),
      domains: DOMS,
      pool,
      schedule: "cycle",
    });
    if (i === 0) firstId = picks[0].question.id;
    for (const pick of picks) {
      assert.ok(!seen.has(pick.question.id), `周期内重复了 ${pick.question.id}`);
      seen.add(pick.question.id);
    }
  }

  const day36 = buildDailySet({
    dateKey: shiftDay("2026-11-01", 36),
    domains: DOMS,
    pool,
    schedule: "cycle",
  });
  assert.equal(day36[0].question.id, firstId, "第 37 天应回到周期起点");
});

test("cycle：首日仍按 1,1,2,2,3 的难度曲线出题", () => {
  const pool = makePool(DOMS, 60);
  const picks = buildDailySet({
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    schedule: "cycle",
  });
  assert.deepEqual(
    picks.map((p) => p.question.difficulty),
    difficultyCurve(DEFAULT_DAILY_COUNT)
  );
});

test("cycle：保留彩蛋题换域语义", () => {
  const pool = makePool(DOMS, 60);
  const picks = buildDailySet({
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    schedule: "cycle",
  });
  const last = picks[picks.length - 1];
  const prev = picks[picks.length - 2];
  assert.equal(last.isEgg, true);
  assert.notEqual(last.question.domain, prev.question.domain);
});

test("cycle：领域输入顺序不影响题集（集合语义）", () => {
  const pool = makePool(DOMS, 60);
  const a = buildDailySet({
    dateKey: "2026-11-01",
    domains: ["gaming", "tech", "life"],
    pool,
    schedule: "cycle",
  });
  const b = buildDailySet({
    dateKey: "2026-11-01",
    domains: ["life", "gaming", "tech"],
    pool,
    schedule: "cycle",
  });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
});

test("cycle：显式 seed 下同码同日同题，异码异题", () => {
  const pool = makePool(DOMS, 60);
  const a = buildDailySet({
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    seed: 12345,
    schedule: "cycle",
  });
  const b = buildDailySet({
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    seed: 12345,
    schedule: "cycle",
  });
  const c = buildDailySet({
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    seed: 999,
    schedule: "cycle",
  });

  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
  assert.notDeepEqual(
    a.map((p) => p.question.id),
    c.map((p) => p.question.id)
  );
});

test("cycle：allowedTypes 过滤仍然生效", () => {
  const pool = makePool(["gaming"], 60);
  for (const q of pool.gaming ?? []) q.type = "multi";
  const picks = buildDailySet({
    dateKey: "2026-11-01",
    domains: ["gaming"],
    pool,
    schedule: "cycle",
    allowedTypes: ["single", "judge"],
  });
  assert.deepEqual(picks, []);
});

test("cycle：题量不足时同样允许重复兜底", () => {
  const pool = makePool(["gaming"], 2);
  const picks = buildDailySet({
    dateKey: "2026-11-01",
    domains: ["gaming"],
    pool,
    count: 5,
    schedule: "cycle",
  });
  assert.equal(picks.length, 5);
});

test("题量不足时允许重复兜底，绝不返回空", () => {
  const pool = makePool(["gaming"], 2);
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming"], pool, count: 5 });
  assert.equal(picks.length, 5, "题量不足时应重复填满，而不是返回空");
});

test("某域为空时用其他域补位", () => {
  const pool = makePool(["gaming", "tech"], 40);
  delete pool.gaming;
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "tech"], pool });
  assert.ok(picks.length > 0);
  for (const p of picks) assert.equal(p.question.domain, "tech");
});

test("全部领域为空时返回空数组（由调用方提示）", () => {
  const picks = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming"], pool: {} });
  assert.deepEqual(picks, []);
});

test("纯函数：不修改入参题池", () => {
  const pool = makePool(DOMS, 10);
  const before = JSON.stringify(pool);
  buildDailySet({ dateKey: "2026-10-20", domains: DOMS, pool });
  assert.equal(JSON.stringify(pool), before, "题池不应被修改");
});

test("NPC 未提供领域顺序时与接线前逐题一致（回归基线）", () => {
  // 基线是接线前从 `buildDailySet` 实测导出的题号 —— 用来防止默认路径被悄悄改掉。
  const pool = makePool(DOMS, 60);

  const jan16 = buildDailySet({
    dateKey: "2026-01-16",
    domains: DOMS,
    pool,
    schedule: "cycle",
  });
  assert.deepEqual(
    jan16.map((p) => p.question.id),
    ["gaming-0030", "life-0006", "tech-0037", "gaming-0022", "life-0056"],
    "无 domainOrder 时必须与改动前逐题一致"
  );

  const nov01 = buildDailySet({
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    schedule: "cycle",
  });
  assert.deepEqual(
    nov01.map((p) => p.question.id),
    ["life-0048", "tech-0039", "gaming-0007", "life-0046", "tech-0038"],
    "无 domainOrder 时必须与改动前逐题一致"
  );
});

test("NPC 领域顺序：只重排当日先后，题集与配比不变（红线：全网同题）", () => {
  const pool = makePool(DOMS, 60);
  const base = buildDailySet({
    dateKey: "2026-01-16",
    domains: DOMS,
    pool,
    schedule: "cycle",
  });
  const ordered = buildDailySet({
    dateKey: "2026-01-16",
    domains: DOMS,
    pool,
    schedule: "cycle",
    domainOrder: ["life", "tech", "gaming"],
  });

  // 题集必须完全相同：顺序变化不能让任何人拿到不同的题。
  assert.deepEqual(
    ordered
      .map((p) => p.question.id)
      .slice()
      .sort(),
    base
      .map((p) => p.question.id)
      .slice()
      .sort(),
    "NPC 不得改变当日题集"
  );

  // 配比不变：每个域出现的次数一致。
  const count = (picks: typeof base, domain: DomainId) =>
    picks.filter((p) => p.question.domain === domain).length;
  for (const domain of DOMS) {
    assert.equal(count(ordered, domain), count(base, domain), `${domain} 的题量不应变化`);
  }

  // 弱域排到最前，彩蛋题仍在末位。
  assert.equal(ordered[0]?.question.domain, "life", "弱域题应排第一");
  assert.equal(ordered[ordered.length - 1]?.isEgg, true, "彩蛋题固定末位");
});

test("NPC 领域顺序：同 seed + 同顺序 → 逐题可复现", () => {
  const pool = makePool(DOMS, 60);
  const args = {
    dateKey: "2026-11-01",
    domains: DOMS,
    pool,
    schedule: "cycle" as const,
    domainOrder: ["tech", "life", "gaming"] as DomainId[],
  };
  const a = buildDailySet(args);
  const b = buildDailySet(args);
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id)
  );
  assert.equal(a[0]?.question.domain, "tech");
});

test("dailySeed 稳定且随领域变化", () => {
  assert.equal(dailySeed("2026-10-20", DOMS), dailySeed("2026-10-20", DOMS));
  assert.notEqual(dailySeed("2026-10-20", DOMS), dailySeed("2026-10-20", ["gaming"]));
});

test("dailySeed 与领域输入顺序无关（同一组领域 = 集合）", () => {
  assert.equal(
    dailySeed("2026-10-20", ["gaming", "tech", "life"]),
    dailySeed("2026-10-20", ["life", "gaming", "tech"])
  );
  assert.equal(
    dailySeed("2026-10-20", ["gaming", "tech"]),
    dailySeed("2026-10-20", ["tech", "gaming"])
  );
});

test("同一组领域、不同点选顺序 → 同一份题集（全网同题的前提）", () => {
  const pool = makePool(DOMS, 40);
  const a = buildDailySet({ dateKey: "2026-10-20", domains: ["gaming", "tech", "life"], pool });
  const b = buildDailySet({ dateKey: "2026-10-20", domains: ["life", "gaming", "tech"], pool });
  assert.deepEqual(
    a.map((p) => p.question.id),
    b.map((p) => p.question.id),
    "领域顺序不同却拿到不同题集，会直接破坏「全网同题」"
  );
});

test("canonicalDomains 返回排序副本，不修改入参", () => {
  const input: DomainId[] = ["life", "gaming", "tech"];
  const out = canonicalDomains(input);
  assert.deepEqual(out, ["gaming", "life", "tech"]);
  assert.deepEqual(input, ["life", "gaming", "tech"], "入参不应被修改");
});

test("difficultyCurve：5 题时为 1,1,2,2,3", () => {
  assert.deepEqual(difficultyCurve(5), [1, 1, 2, 2, 3]);
});

test("pickRandomDomains：同一天结果一致，跨天可不同", () => {
  const a = pickRandomDomains("2026-10-20", DOMS, 3);
  const b = pickRandomDomains("2026-10-20", DOMS, 3);
  assert.deepEqual(a, b);
  assert.equal(a.length, 3);
});

test("pickDomainsBySeed：同 seed 一致，数量不超过候选数", () => {
  const a = pickDomainsBySeed(42, DOMS, 3);
  const b = pickDomainsBySeed(42, DOMS, 3);
  assert.deepEqual(a, b);
  assert.equal(pickDomainsBySeed(42, ["gaming"], 3).length, 1);
  assert.deepEqual(pickDomainsBySeed(42, [], 3), []);
});

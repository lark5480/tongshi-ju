/**
 * NPC 引擎 · 单元测试
 *
 * 覆盖五条承诺（见 docs/research/2026-11-04-选题论证与差异化声明.md §3.2）：
 * - N1 记住薄弱域：连续答错某域后，该域权重显著上升；
 * - N2 影响玩法：选域与选题确实改变（不只是陪聊）；
 * - N3 降级不崩：无模型端点时仍出决策、仍出点评，且显式标注降级；
 * - N4 治理证据：决策带 rationale 与权重，可查可解释；
 * - N5 可复现：同 seed + 同输入 → 同决策。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AnswerEvent, NpcContext, NpcFacts } from "../lib/npc/types";
import {
  buildAnswerEvent,
  buildCommentary,
  buildFacts,
  computeDomainWeights,
  decideNpc,
  narrate,
  orderQuestions,
  pickWeakestDomain,
  retrieveEpisodes,
  ruleImportance,
  toEpisode,
  updateFacts,
} from "../lib/npc";
import { buildNpcContext } from "../lib/npc/storage";
import type { Question } from "../types";

const NOW = 1_760_000_000_000;

function q(id: string, domain: string, topic: string, difficulty = 1): Question {
  return {
    id,
    domain: domain as Question["domain"],
    topic,
    difficulty: difficulty as Question["difficulty"],
    type: "single",
    stem: "题目",
    options: ["A", "B", "C", "D"],
    answer: "A",
    explanation: "解析",
    origin: "seed",
    fingerprint: "00000000",
  } as unknown as Question;
}

function event(over: Partial<AnswerEvent> = {}): AnswerEvent {
  return {
    questionId: "q1",
    domain: "gaming" as AnswerEvent["domain"],
    topic: "T1",
    difficulty: 1,
    correct: true,
    streak: 0,
    at: NOW - 3600_000,
    ...over,
  };
}

function emptyFacts(): NpcFacts {
  return {
    mastery: {},
    wrongCounts: {},
    attemptCounts: {},
    lastSeenAt: {},
    touchedDomains: 0,
  };
}

function ctx(over: Partial<NpcContext> = {}): NpcContext {
  return {
    userId: "u1",
    domains: ["gaming", "tech"] as NpcContext["domains"],
    pool: {
      gaming: [q("g1", "gaming", "T1"), q("g2", "gaming", "T2"), q("g3", "gaming", "T3")],
      tech: [q("t1", "tech", "T1"), q("t2", "tech", "T2")],
    } as NpcContext["pool"],
    facts: emptyFacts(),
    episodes: [],
    seed: 42,
    now: NOW,
    ...over,
  };
}

// ---------------------------------------------------------------- 事实层

test("事实层：答错降低掌握度，答对提升", () => {
  let facts = emptyFacts();
  facts = updateFacts(
    facts,
    event({ correct: false, domain: "gaming" as AnswerEvent["domain"] }),
    false
  );
  const afterWrong = facts.mastery["gaming"] ?? 0;

  facts = updateFacts(
    facts,
    event({ correct: true, domain: "gaming" as AnswerEvent["domain"] }),
    false
  );
  const afterRight = facts.mastery["gaming"] ?? 0;

  assert.ok(afterRight > afterWrong, `答对后掌握度应高于答错后：${afterWrong} → ${afterRight}`);
  assert.equal(facts.attemptCounts["gaming"], 2);
  assert.equal(facts.wrongCounts["gaming"], 1);
});

test("事实层：首次答错 ≠ 从未碰过（否则最重要的信号被抹平）", () => {
  // 掌握度下界是 0，若首次答错从 0 起算会被钳到 0，与"完全没碰过"无法区分。
  const facts = updateFacts(emptyFacts(), event({ correct: false }), false);
  const mastery = facts.mastery["gaming"] ?? 0;
  assert.ok(mastery > 0, `首次答错后掌握度应为正（区分于从未碰过）：实际 ${mastery}`);
  assert.ok(mastery < 0.5, `首次答错后掌握度应低于中性值 0.5：实际 ${mastery}`);
});

test("事实层：首次触达计入 touchedDomains", () => {
  const facts = updateFacts(emptyFacts(), event(), true);
  assert.equal(facts.touchedDomains, 1);
  const facts2 = updateFacts(facts, event(), false);
  assert.equal(facts2.touchedDomains, 1, "非首次触达不应重复计数");
});

// ---------------------------------------------------------------- 重要度

test("重要度：答错 = 10，新域答对 = 6，老域答对 = 3", () => {
  assert.equal(ruleImportance(event({ correct: false }), false), 10);
  assert.equal(ruleImportance(event({ correct: true }), true), 6);
  assert.equal(ruleImportance(event({ correct: true }), false), 3);
});

test("重要度：连击下调（已掌握的不必反复占名额）", () => {
  const low = ruleImportance(event({ correct: true, streak: 0 }), false);
  const high = ruleImportance(event({ correct: true, streak: 4 }), false);
  assert.ok(high < low, `连击 4 的重要度应低于连击 0：${high} vs ${low}`);
});

// ---------------------------------------------------------------- 检索

test("检索：三段式评分命中同域且难度匹配的条目", () => {
  const episodes = [
    toEpisode({
      event: event({ questionId: "a", domain: "gaming" as AnswerEvent["domain"], correct: false }),
      isNewDomain: false,
    }),
    toEpisode({
      event: event({ questionId: "b", domain: "tech" as AnswerEvent["domain"] }),
      isNewDomain: false,
    }),
  ];
  const hits = retrieveEpisodes({ episodes, domain: "gaming", difficulty: 1, now: NOW });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.episode.questionId, "a");
  assert.equal(hits[0]?.relevance, 1);
  assert.ok((hits[0]?.score ?? 0) > 0);
});

test("检索：跨域条目不入选（relevance = 0）", () => {
  const episodes = [
    toEpisode({
      event: event({ questionId: "b", domain: "tech" as AnswerEvent["domain"] }),
      isNewDomain: false,
    }),
  ];
  const hits = retrieveEpisodes({ episodes, domain: "gaming", now: NOW });
  assert.equal(hits.length, 0);
});

test("检索：topK 上限生效", () => {
  const episodes = ["a", "b", "c", "d"].map((id) =>
    toEpisode({
      event: event({ questionId: id, domain: "gaming" as AnswerEvent["domain"] }),
      isNewDomain: false,
    })
  );
  const hits = retrieveEpisodes({ episodes, domain: "gaming", now: NOW, topK: 2 });
  assert.equal(hits.length, 2);
});

// ---------------------------------------------------------------- 策略

test("N1 记住薄弱域：答错多的域权重更高", () => {
  const facts = updateFacts(
    updateFacts(
      emptyFacts(),
      event({ correct: false, domain: "gaming" as AnswerEvent["domain"] }),
      false
    ),
    event({ correct: false, domain: "gaming" as AnswerEvent["domain"], questionId: "q2" }),
    false
  );
  const weights = computeDomainWeights(ctx({ facts }));
  assert.ok(
    (weights["gaming"] ?? 0) > (weights["tech"] ?? 0),
    `gaming 应比 tech 更该练：${JSON.stringify(weights)}`
  );
});

test("N1：领域排序把最该练的放首位", () => {
  const facts = updateFacts(
    emptyFacts(),
    event({ correct: false, domain: "tech" as AnswerEvent["domain"] }),
    false
  );
  const decision = decideNpc({ context: ctx({ facts }), commentary: "x" });
  assert.equal(decision.domainOrder[0], "tech");
});

test("N2：同域内按 topic 自己的熟练度排序（域均值会抹平差异）", () => {
  // 两个 topic 同属 gaming：T1 从未答对（0），T2 已净答对 10 次（满星）。
  // 域均值是 5 —— 旧实现把 5 赋给两个 topic，排序退化成随机平分。
  const facts: NpcFacts = {
    mastery: { gaming: 5 },
    topicMastery: { "gaming|T1": 0, "gaming|T2": 10 },
    wrongCounts: {},
    attemptCounts: { gaming: 4 },
    lastSeenAt: {},
    touchedDomains: 1,
  };
  const context = ctx({
    facts,
    pool: {
      gaming: [q("g1", "gaming", "T1"), q("g2", "gaming", "T2")],
    } as NpcContext["pool"],
    seed: 2,
  });

  const order = orderQuestions({ context, domain: "gaming" });
  // 低熟练度的 T1 必须排前；旧实现（域均值 5/5）在 seed=2 下平分后先出 g2。
  assert.equal(order[0], "g1", `应按 topic 熟练度选 g1，实际顺序：${order.join(",")}`);
});

test("事实层：buildFacts 保留 topic 级原值（不被域均值覆盖）", () => {
  const facts = buildFacts({
    mastery: { "gaming|T1": 0, "gaming|T2": 10 },
    attemptCounts: { gaming: 4 },
  });
  assert.equal(facts.mastery["gaming"], 5, "域级仍是算术平均");
  assert.equal(facts.topicMastery?.["gaming|T1"], 0, "topic 原值必须保留");
  assert.equal(facts.topicMastery?.["gaming|T2"], 10, "topic 原值必须保留");
});

test("事实层：updateFacts 增量维护 topic 值（答对 +1、答错 −1、下界 0）", () => {
  let facts = emptyFacts();
  facts = updateFacts(facts, event({ correct: true, topic: "T1" }), true);
  assert.equal(facts.topicMastery?.["gaming|T1"], 1);
  facts = updateFacts(facts, event({ correct: false, topic: "T1" }), false);
  assert.equal(facts.topicMastery?.["gaming|T1"], 0, "净答对数不应小于 0");
});

test("N2 影响玩法：选题顺序把错题排前面", () => {
  const episodes = [
    toEpisode({
      event: event({ questionId: "g3", domain: "gaming" as AnswerEvent["domain"], correct: false }),
      isNewDomain: false,
    }),
  ];
  const order = orderQuestions({ context: ctx({ episodes }), domain: "gaming" });
  assert.equal(order[0], "g3", "答错过的题应排最前");
  assert.equal(order.length, 3);
});

test("N4 治理证据：决策带 rationale 与权重", () => {
  const decision = decideNpc({ context: ctx(), commentary: "点评" });
  assert.ok(decision.rationale.length > 0, "必须给出决策依据");
  assert.ok(Object.keys(decision.weights).length === 2);
  assert.equal(decision.commentary, "点评");
});

test("N5 可复现：同 seed 同输入 → 同决策", () => {
  const facts = updateFacts(emptyFacts(), event({ correct: false }), false);
  const a = decideNpc({ context: ctx({ facts, seed: 7 }), commentary: "c" });
  const b = decideNpc({ context: ctx({ facts, seed: 7 }), commentary: "c" });
  assert.deepEqual(a.domainOrder, b.domainOrder);
  assert.deepEqual(a.questionOrder, b.questionOrder);
});

test("N5：异 seed → 可能有差异但都必须合法", () => {
  const a = decideNpc({ context: ctx({ seed: 1 }), commentary: "c" });
  const b = decideNpc({ context: ctx({ seed: 2 }), commentary: "c" });
  assert.ok(a.domainOrder.length === 2 && b.domainOrder.length === 2);
});

// ---------------------------------------------------------------- 降级

test("N3 降级不崩：无模型端点时仍给出合法决策", async () => {
  const result = await narrate({ context: ctx(), model: null });
  assert.equal(result.degraded, true);
  assert.ok(result.degradedReason, "必须写明降级原因");
  assert.equal(result.decision.degraded, true);
  assert.ok(result.decision.commentary.length > 0, "降级也要有点评");
  assert.ok(result.decision.domainOrder.length === 2);
});

test("N3 降级不崩：模型抛错时降级而非上抛", async () => {
  const failing = {
    name: "failing",
    generate: async () => {
      throw new Error("连接被拒");
    },
  };
  const result = await narrate({ context: ctx(), model: failing });
  assert.equal(result.degraded, true);
  assert.ok(result.degradedReason?.includes("连接被拒"));
  assert.ok(result.decision.commentary.length > 0);
});

test("N3 降级不崩：模型超时时不拖垮主链路", async () => {
  const hanging = {
    name: "hanging",
    generate: () => new Promise<never>(() => {}),
  };
  const result = await narrate({ context: ctx(), model: hanging, timeoutMs: 50 });
  assert.equal(result.degraded, true);
  assert.ok(result.decision.commentary.length > 0);
});

test("模型正常时：使用模型台词且不标降级", async () => {
  const ok = {
    name: "ok",
    generate: async () => ({ commentary: "多练 gaming 这个域。" }),
  };
  const result = await narrate({ context: ctx(), model: ok });
  assert.equal(result.degraded, false);
  assert.equal(result.decision.commentary, "多练 gaming 这个域。");
});

test("降级点评：随事实变化（不同域 → 不同话）", () => {
  const a = buildCommentary(ctx({ facts: emptyFacts() }));
  const facts = updateFacts(
    emptyFacts(),
    event({ correct: false, domain: "tech" as AnswerEvent["domain"] }),
    false
  );
  const b = buildCommentary(ctx({ facts }));
  assert.notEqual(a, b, "不同状态应给出不同点评");
  assert.ok(b.includes("科技"), "点评应点名最薄弱的域");
});

// ---------------------------------------------------------------- 数据口径回归

test("口径：mastery 是净答对数，不是 0-1 概率 —— 净答对 1 次不该被当成'完全掌握'", () => {
  // 既有引擎 `recordMastery`：答对 +1、答错 −1、下界 0；
  // `masteryStars` 用 value/2 → 满星 5 星 = 10 次净答对。
  //
  // 若把 mastery 当 0-1 概率用（`1 - clamp01(mastery)`）：
  //   净答对 1 次 → clamp01(1)=1 → 薄弱度 0 → 该域被判"完全掌握"，
  //   权重掉到 0.167 —— 几乎等于"不用练"。
  //
  // 权重语义：**越高 = 越该练**（越薄弱）。
  // 修正后净答对 1 次的域薄弱度是 0.9（接近满格），
  // 而不是修正前的 0.0（几乎不用练）。
  //
  // 判据：同条件下（同样答题次数、同样无错题），净答对 1 次的域
  // 权重必须**明显高于**"净答对 10 次（满星）"的域。
  const facts: NpcFacts = {
    ...buildFacts({ mastery: { "gaming|A": 1, "tech|B": 10 } }),
    attemptCounts: { gaming: 3, tech: 3 },
  };
  const weights = computeDomainWeights(
    ctx({
      facts,
      domains: ["gaming", "tech"] as NpcContext["domains"],
    })
  );
  assert.ok(
    (weights["gaming"] ?? 0) > (weights["tech"] ?? 0),
    `净答对 1 次的 gaming 应比满星（10 次）的 tech 更该练：${JSON.stringify(weights)}`
  );
  // 关键：修正前 gaming 会被算成 0.167（≈不用练），修正后必须仍接近满格。
  assert.ok(
    (weights["gaming"] ?? 0) > 0.5,
    `净答对 1 次不该被判为"几乎不用练"（权重应 > 0.5）：${JSON.stringify(weights)}`
  );
});

test("口径：领域熟练度按满星刻度归一（10 次净答对 = 完全掌握）", () => {
  // 两个域答题次数相同、无错题，只有净答对数不同。
  const facts: NpcFacts = {
    ...buildFacts({ mastery: { "gaming|A": 10, "tech|B": 1 } }),
    attemptCounts: { gaming: 10, tech: 10 },
  };
  const weights = computeDomainWeights(
    ctx({
      facts,
      domains: ["gaming", "tech"] as NpcContext["domains"],
    })
  );
  // 权重越高 = 越该练（越薄弱）→ 满星的 gaming 权重应**更低**。
  assert.ok(
    (weights["gaming"] ?? 0) < (weights["tech"] ?? 0),
    `净答对 10 次（满星）的 gaming 应比净答对 1 次的 tech 更少练：${JSON.stringify(weights)}`
  );
  // 且 10 次（满星）必须比 1 次更接近掌握。
  const factsOne: NpcFacts = {
    ...buildFacts({ mastery: { "gaming|A": 1 } }),
    attemptCounts: { gaming: 10 },
  };
  const weightsOne = computeDomainWeights(
    ctx({ facts: factsOne, domains: ["gaming"] as NpcContext["domains"] })
  );
  assert.ok(
    (weights["gaming"] ?? 0) < (weightsOne["gaming"] ?? 0),
    `净答对 10 次应比 1 次更接近掌握：${JSON.stringify(weights)} vs ${JSON.stringify(weightsOne)}`
  );
});

test("口径：降级点评按满星刻度判档，不把'净答对 1 次'说成熟练度不错", () => {
  const facts: NpcFacts = {
    ...emptyFacts(),
    mastery: { gaming: 1 },
    attemptCounts: { gaming: 3 },
  };
  const text = buildCommentary(ctx({ facts, domains: ["gaming"] as NpcContext["domains"] }));
  assert.ok(text.includes("熟练度偏低"), `净答对 1 次应判为偏低，实际：${text}`);
  assert.ok(!text.includes("gaming"), `玩家可见文案应使用中文域名，实际：${text}`);
});

test("口径：点评域恒等于 domainOrder[0]，最近性可改变排序", () => {
  const facts: NpcFacts = {
    mastery: { gaming: 0, tech: 0 },
    wrongCounts: { gaming: 0, tech: 0 },
    attemptCounts: { gaming: 2, tech: 2 },
    lastSeenAt: { gaming: NOW, tech: NOW - 30 * 86_400_000 },
    touchedDomains: 2,
  };
  // tech 排在 domains 首位：旧的两项公式（无 recent）会因平分而选 tech。
  const context = ctx({ facts, domains: ["tech", "gaming"] as NpcContext["domains"] });
  const commentary = buildCommentary(context);
  const decision = decideNpc({ context, commentary, degraded: true });

  assert.equal(pickWeakestDomain(context), "gaming", `应选刚练过的 gaming，实际：${commentary}`);
  assert.equal(
    decision.domainOrder[0],
    pickWeakestDomain(context),
    "点评域必须等于 domainOrder[0]"
  );
  assert.ok(commentary.includes("游戏"), `点评应点名中文域名，实际：${commentary}`);
});

test("术语：点评文案不含英文域 id，也不含「掌握度」", () => {
  const cases: NpcFacts[] = [
    emptyFacts(),
    {
      ...emptyFacts(),
      mastery: { gaming: 0 },
      attemptCounts: { gaming: 3 },
      wrongCounts: { gaming: 2 },
      lastSeenAt: { gaming: NOW },
    },
    { ...emptyFacts(), mastery: { gaming: 8 }, attemptCounts: { gaming: 3 } },
  ];
  const ids =
    /\b(gaming|anime|tech|coding|life|history|auto|mobile|film|science|literature|travel)\b/;

  for (const facts of cases) {
    const text = buildCommentary(ctx({ facts, domains: ["gaming"] as NpcContext["domains"] }));
    assert.ok(!ids.test(text), `点评不应含英文域 id：${text}`);
    assert.ok(!text.includes("掌握度"), `点评不应含旧术语：${text}`);
    assert.ok(text.includes("游戏"), `点评应使用中文域名：${text}`);
  }
});

test("事实层：同域多知识点取算术平均（不是后写覆盖），且顺序无关", () => {
  const forward = buildFacts({ mastery: { "gaming|A": 1, "gaming|B": 3 } });
  assert.equal(forward.mastery["gaming"], 2);

  const reverse = buildFacts({ mastery: { "gaming|B": 3, "gaming|A": 1 } });
  assert.equal(reverse.mastery["gaming"], 2, "键顺序不应影响结果");

  const multi = buildFacts({
    mastery: { "gaming|A": 0, "life|A": 4, "life|B": 0, "life|C": 2 },
  });
  assert.equal(multi.mastery["gaming"], 0);
  assert.equal(multi.mastery["life"], 2, "life = (4 + 0 + 2) / 3");
});

test("事实层：history 与情景层不重复计入同一次作答", () => {
  const episodes = [
    toEpisode({ event: event({ questionId: "g1" }), isNewDomain: false }),
    toEpisode({ event: event({ questionId: "g2" }), isNewDomain: false }),
    toEpisode({
      event: event({ questionId: "t1", domain: "tech" as AnswerEvent["domain"] }),
      isNewDomain: false,
    }),
  ];
  const facts = buildNpcContext({
    userId: "u1",
    domains: ["gaming", "tech", "life"] as NpcContext["domains"],
    pool: {},
    mastery: {},
    wrongEntries: [],
    history: [{ domains: ["gaming", "life"] as NpcContext["domains"], correct: 1, total: 5 }],
    episodes,
    seed: 42,
    now: NOW,
  }).facts;

  assert.equal(facts.attemptCounts["gaming"], 2, "情景层已覆盖 gaming，history 不得再叠加");
  assert.equal(facts.attemptCounts["tech"], 1);
  assert.equal(facts.attemptCounts["life"], 1, "情景层无 life 时 history 只做下限补位");
});

test("事实层：无情景记录时 history 按场次下限计，不把整局题量摊给每个域", () => {
  const facts = buildNpcContext({
    userId: "u1",
    domains: ["life"] as NpcContext["domains"],
    pool: {},
    mastery: {},
    wrongEntries: [],
    history: [
      { domains: ["life"] as NpcContext["domains"], correct: 2, total: 5 },
      { domains: ["life"] as NpcContext["domains"], correct: 3, total: 5 },
    ],
    episodes: [],
    seed: 42,
    now: NOW,
  }).facts;
  assert.equal(facts.attemptCounts["life"], 2, "下限 = 涉及该域的场次数，不是 10");
});

test("重要度：连击取本局真实值，一路传到情景层（0 不降权，4 降两档）", () => {
  const idle = buildAnswerEvent({
    questionId: "q1",
    domain: "gaming" as AnswerEvent["domain"],
    topic: "T1",
    difficulty: 1,
    correct: true,
    combo: 0,
    at: NOW,
  });
  assert.equal(idle.streak, 0);
  assert.equal(ruleImportance(idle, false), 3);

  const hot = buildAnswerEvent({
    questionId: "q2",
    domain: "gaming" as AnswerEvent["domain"],
    topic: "T1",
    difficulty: 1,
    correct: true,
    combo: 4,
    at: NOW,
  });
  assert.equal(hot.streak, 4, "不得再回落到 0，否则连击降权永不生效");
  assert.equal(ruleImportance(hot, false), 1);
  assert.equal(toEpisode({ event: hot, isNewDomain: false }).importance, 1);

  const wrong = buildAnswerEvent({
    questionId: "q3",
    domain: "gaming" as AnswerEvent["domain"],
    topic: "T1",
    difficulty: 1,
    correct: false,
    combo: 0,
    at: NOW,
  });
  assert.equal(ruleImportance(wrong, false), 10);
});

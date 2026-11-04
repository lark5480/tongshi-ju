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
  buildCommentary,
  buildFacts,
  computeDomainWeights,
  decideNpc,
  narrate,
  orderQuestions,
  retrieveEpisodes,
  ruleImportance,
  toEpisode,
  updateFacts,
} from "../lib/npc";
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
  assert.ok(b.includes("tech"), "点评应点名最薄弱的域");
});

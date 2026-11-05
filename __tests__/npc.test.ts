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
  formatMemoryReason,
  narrate,
  orderQuestions,
  pickPracticeQuestion,
  pickWeakestDomain,
  rankDomains,
  resolveCommentaryStatus,
  retrieveEpisodes,
  ruleImportance,
  selectMemories,
  toEpisode,
  updateFacts,
} from "../lib/npc";
import {
  buildPendingDecision,
  loadCoachEpisodes,
  recordCoachEvent,
  requestCoach,
  resetNpcModelStateForTest,
} from "../lib/npc/client";
import { extractImportanceFromModel } from "../lib/npc/core/importance";
import {
  buildNpcContext,
  episodeId,
  NPC_EPISODES_KEY,
  recordNpcEpisode,
  updateEpisodeImportance,
  type StoredEpisode,
} from "../lib/npc/storage";
import { buildDailySet } from "../lib/engine/daily";
import type { DomainId, Question } from "../types";

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

// ------------------------------------------------------------ 4+1 第 5 题（加练）

/** 构造「最弱域 = gaming，域内 T1 最生疏」的事实。 */
function weakGamingFacts(): NpcFacts {
  return {
    mastery: { gaming: 1, tech: 9 },
    topicMastery: {
      "gaming|T1": 0,
      "gaming|T2": 3,
      "gaming|T3": 2,
      "tech|T1": 5,
      "tech|T2": 5,
    },
    wrongCounts: { gaming: 3 },
    attemptCounts: { gaming: 5, tech: 3 },
    lastSeenAt: {},
    touchedDomains: 2,
  };
}

test("4+1 第 5 题：最弱域优先，域内取 topic 熟练度最低的题", () => {
  const pick = pickPracticeQuestion({
    context: ctx({ facts: weakGamingFacts() }),
    excludeIds: new Set<string>(),
  });
  assert.ok(pick, "有事实时必须能选出加练题");
  assert.equal(pick!.question.id, "g1", `应选最弱域 gaming 里 T1 的 g1，实际 ${pick!.question.id}`);
  assert.match(pick!.reason, /游戏/, "依据应点名最弱域");
  assert.match(pick!.reason, /3 次/, "依据应给出错题次数");
});

test("4+1 第 5 题：排除前 4 题已出现的题，同域取完顺延下一个域", () => {
  const context = ctx({ facts: weakGamingFacts() });
  const first = pickPracticeQuestion({ context, excludeIds: new Set(["g1", "g2"]) });
  assert.equal(first?.question.id, "g3", "g1/g2 被排除后应取 g3");

  const none = pickPracticeQuestion({
    context,
    excludeIds: new Set(["g1", "g2", "g3", "t1", "t2"]),
  });
  assert.equal(none, undefined, "全部题目都被排除时应返回 undefined，由调用方回落");
});

test("4+1 第 5 题：同 seed + 同事实 → 同题（可复现）", () => {
  const a = pickPracticeQuestion({
    context: ctx({ facts: weakGamingFacts(), seed: 7 }),
    excludeIds: new Set(["g1"]),
  });
  const b = pickPracticeQuestion({
    context: ctx({ facts: weakGamingFacts(), seed: 7 }),
    excludeIds: new Set(["g1"]),
  });
  assert.deepEqual(a, b, "两次调用必须给出完全相同的题与依据");
});

test("4+1：同日重复请求 → 5 题完全一致（公共 4 + 加练 1）", () => {
  const domains = ["gaming", "tech"] as DomainId[];
  const build = () => {
    const picks = buildDailySet({
      dateKey: "2026-11-04",
      domains,
      pool: ctx().pool,
      schedule: "cycle",
    });
    const publicIds = picks.slice(0, 4).map((p) => p.question.id);
    const practice = pickPracticeQuestion({
      context: ctx({ facts: weakGamingFacts() }),
      excludeIds: new Set(publicIds),
    });
    return [...publicIds, practice?.question.id ?? picks[4]?.question.id];
  };
  assert.deepEqual(build(), build(), "同一天重复请求必须拿到同一份 5 题");
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

test("reply 键：LongCat 等模型的一句话说也能识别为台词", async () => {
  const model = {
    name: "reply-model",
    generate: async () => ({ reply: "游戏 4 题错 3，今天先补它。" }),
  };
  const result = await narrate({ context: ctx(), model });
  assert.equal(result.degraded, false);
  assert.equal(result.decision.commentary, "游戏 4 题错 3，今天先补它。");
});

test("未知键名兜底：comment / 点评 也能提取台词", async () => {
  const comment = {
    name: "comment-model",
    generate: async () => ({ comment: "先练游戏，4 题错 3。" }),
  };
  const chinese = {
    name: "chinese-key-model",
    generate: async () => ({ 点评: "今天先补科学。" }),
  };
  const a = await narrate({ context: ctx(), model: comment });
  const b = await narrate({ context: ctx(), model: chinese });
  assert.equal(a.degraded, false);
  assert.equal(a.decision.commentary, "先练游戏，4 题错 3。");
  assert.equal(b.degraded, false);
  assert.equal(b.decision.commentary, "今天先补科学。");
});

test("空正文仍降级：调大 token 不能吞掉失败", async () => {
  const empty = {
    name: "empty-model",
    generate: async () => ({ commentary: "   " }),
  };
  const result = await narrate({ context: ctx(), model: empty });
  assert.equal(result.degraded, true);
  assert.ok(result.degradedReason?.includes("空"), "降级原因必须说明正文为空");
});

test("finish_reason=length 且正文为空：按倍数追加额度重试一次", async () => {
  const budgets: number[] = [];
  const model = {
    name: "retry-model",
    generate: async () => ({ commentary: "不应走到这里" }),
    generateWithMeta: async (_prompt: string, opts?: { maxTokens?: number }) => {
      const maxTokens = opts?.maxTokens ?? 0;
      budgets.push(maxTokens);
      if (budgets.length === 1) {
        return {
          value: null,
          meta: { finishReason: "length", contentEmpty: true, maxTokens },
        };
      }
      return {
        value: { reply: "重试后拿到台词。" },
        meta: { finishReason: "stop", contentEmpty: false, maxTokens },
      };
    },
  };
  const result = await narrate({ context: ctx(), model });
  assert.equal(result.degraded, false);
  assert.equal(result.decision.commentary, "重试后拿到台词。");
  // 基础额度 800，不足时翻倍到 1600 —— 不在各处硬编码另一个数
  assert.deepEqual(budgets, [800, 1600]);
});

test("两次都思维链耗尽：降级原因写明 finish_reason=length", async () => {
  const model = {
    name: "always-length-model",
    generate: async () => ({ commentary: "不应走到这里" }),
    generateWithMeta: async (_prompt: string, opts?: { maxTokens?: number }) => {
      const maxTokens = opts?.maxTokens ?? 0;
      return { value: null, meta: { finishReason: "length", contentEmpty: true, maxTokens } };
    },
  };
  const result = await narrate({ context: ctx(), model });
  assert.equal(result.degraded, true);
  assert.ok(result.degradedReason?.includes("思维链耗尽"), result.degradedReason);
  assert.ok(result.degradedReason?.includes("1600"), result.degradedReason);
});

// ---------------------------------------------------------------- 点评三态

test("点评三态：缺省按 degraded 推断，pending 不冒充失败", () => {
  assert.equal(
    resolveCommentaryStatus(decideNpc({ context: ctx(), commentary: "模型台词" })),
    "model"
  );
  const degraded = decideNpc({
    context: ctx(),
    commentary: "模板",
    degraded: true,
    degradedReason: "原因",
  });
  assert.equal(resolveCommentaryStatus(degraded), "degraded");
  // 升级前的旧数据没有 commentaryStatus：只能按 degraded 推断。
  assert.equal(resolveCommentaryStatus({ degraded: true }), "degraded");
  assert.equal(resolveCommentaryStatus({ degraded: false }), "model");

  // 模板先行用的是**最新事实**（答 5 错 1），不是开局那份空统计。
  const facts: NpcFacts = {
    ...emptyFacts(),
    attemptCounts: { gaming: 3, tech: 2 },
    wrongCounts: { gaming: 1 },
    mastery: { gaming: 2, tech: 1 },
    touchedDomains: 2,
  };
  const pending = buildPendingDecision(ctx({ facts }));
  assert.equal(pending.commentaryStatus, "pending");
  assert.equal(pending.degraded, false, "模板先行不等于降级");
  assert.ok(pending.rationale.includes("答 5 错 1"), pending.rationale);
});

test("替换时序：pending 同步可用，模型返回后替换为 model", async () => {
  let release!: (res: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => gate) as typeof fetch;
  try {
    // 同步构造，不需要等模型 —— 结算页必须立刻有话。
    const pending = buildPendingDecision(ctx());
    assert.equal(pending.commentaryStatus, "pending");
    assert.ok(pending.commentary.length > 0);

    const pendingRequest = requestCoach({
      userId: "u-seq",
      domains: ["gaming", "tech"] as NpcContext["domains"],
      facts: emptyFacts(),
      episodes: [],
      seed: 1,
      now: NOW,
    });
    // 请求仍挂在 gate 上：此刻展示的是 pending，而不是降级。
    assert.equal(pending.degraded, false);

    release(
      new Response(
        JSON.stringify({
          commentary: "模型台词：先补游戏。",
          degraded: false,
          rationale: "模型决策依据",
          domainOrder: ["gaming", "tech"],
          weights: { gaming: 1, tech: 0.5 },
          provider: "stub",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await pendingRequest;
    assert.equal(result.degraded, false);
    assert.equal(result.decision.commentaryStatus, "model");
    assert.equal(result.decision.commentary, "模型台词：先补游戏。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("失败才降级：HTTP 非 2xx / 网络失败都进入 degraded", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const httpFail = await requestCoach({
      userId: "u-fail",
      domains: ["gaming"] as NpcContext["domains"],
      facts: emptyFacts(),
      episodes: [],
      seed: 1,
      now: NOW,
    });
    assert.equal(httpFail.decision.degraded, true);
    assert.equal(resolveCommentaryStatus(httpFail.decision), "degraded");

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const netFail = await requestCoach({
      userId: "u-fail",
      domains: ["gaming"] as NpcContext["domains"],
      facts: emptyFacts(),
      episodes: [],
      seed: 1,
      now: NOW,
    });
    assert.equal(netFail.decision.degraded, true);
    assert.equal(resolveCommentaryStatus(netFail.decision), "degraded");
    assert.ok(netFail.decision.commentary.length > 0, "降级也要有模板台词");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型可用性只看 provider：点评降级不阻止重要度升级", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/npc/coach")) {
      return new Response(
        JSON.stringify({
          commentary: "模板点评",
          degraded: true,
          degradedReason: "模型调用失败：AI 返回内容为空",
          domainOrder: ["gaming"],
          weights: { gaming: 1 },
          provider: "openai-compatible:LongCat-2.5",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ importance: 4, degraded: false }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await requestCoach({
      userId: "u-provider",
      domains: ["gaming"] as NpcContext["domains"],
      facts: emptyFacts(),
      episodes: [],
      seed: 1,
      now: NOW,
    });
    assert.equal(result.degraded, true);

    await recordCoachEvent({
      userId: "u-provider",
      event: event({ questionId: "prov-1" }),
      facts: emptyFacts(),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(
    calls.some((url) => url.endsWith("/api/npc/importance")),
    "provider 存在时必须请求重要度，即使点评本身降级"
  );
  const episodes = loadCoachEpisodes("u-provider");
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.importance, 4);
  assert.equal(episodes[0]!.importanceSource, "model");
  assert.equal(episodes[0]!.importanceDegraded, false);
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

// ------------------------------------------------------- 数据契约（source / 重要度来源）

test("情景条目：source 与重要度来源落盘；旧事件缺 source 不补写", () => {
  const practice = toEpisode({
    event: event({ questionId: "p1", source: "practice" }),
    isNewDomain: false,
  });
  assert.equal(practice.source, "practice", "加练来源必须保留");
  assert.equal(practice.importanceSource, "rule", "无模型分 → 规则分");
  assert.equal(practice.importanceDegraded, true);
  assert.match(practice.importanceDegradedReason ?? "", /未提供模型重要度/, "降级原因不能为空");

  const modelScored = toEpisode({
    event: event({ questionId: "m1", source: "public" }),
    isNewDomain: true,
    modelImportance: 9,
  });
  assert.equal(modelScored.source, "public");
  assert.equal(modelScored.importanceSource, "model");
  assert.equal(modelScored.importanceDegraded, false);
  assert.equal(modelScored.importance, 9);

  const legacy = toEpisode({ event: event({ questionId: "l1" }), isNewDomain: false });
  assert.equal(legacy.source, undefined, "历史事件没有 source 时不得凭空补字段");
});

test("重要度解析：接受对象 / 数字，解析失败返回 null（由调用方保持规则分）", () => {
  assert.equal(extractImportanceFromModel({ importance: 7 }), 7);
  assert.equal(extractImportanceFromModel({ score: 3 }), 3);
  assert.equal(extractImportanceFromModel(8), 8);
  assert.equal(extractImportanceFromModel("10"), 10);
  assert.equal(extractImportanceFromModel({ foo: "bar" }), null);
  assert.equal(extractImportanceFromModel(null), null);
});

// ------------------------------------------------------------- 排序确定性

test("rankDomains：同权重用确定性 tie-break，两次调用与逆序输入结果一致", () => {
  const context = ctx({
    domains: ["gaming", "tech", "life", "art"] as NpcContext["domains"],
  });
  const weights = { gaming: 0.5, tech: 0.5, life: 0.5, art: 0.5 };

  const first = rankDomains(context, weights);
  const second = rankDomains(context, weights);
  assert.deepEqual(first, second, "同输入必须给出同顺序");

  const reversed = rankDomains(
    { ...context, domains: [...context.domains].reverse() as NpcContext["domains"] },
    weights
  );
  assert.deepEqual(reversed, first, "输入顺序不应影响 tie-break 结果");
});

// ------------------------------------------- 重要度：先同步落盘，模型回来再升级

/** 内存版情景层：返回 read/write 闭包，方便验证同步落盘与升级。 */
function episodeStore() {
  let store: StoredEpisode[] = [];
  return {
    write: (list: StoredEpisode[]) => {
      store = list;
    },
    read: (key: string) => (key === NPC_EPISODES_KEY ? store : []),
    current: () => store,
  };
}

test("重要度升级：先按规则分同步落盘，模型返回后就地升级", () => {
  const db = episodeStore();
  const facts = buildFacts({ mastery: {}, attemptCounts: { gaming: 1 } });
  const ev = event({ questionId: "u1", correct: false, at: NOW });

  const stored = recordNpcEpisode({
    write: db.write,
    read: db.read,
    userId: "u",
    event: ev,
    facts,
    importance: null,
    importanceDegradedReason: "模型重要度尚未返回，先按规则分落盘",
  });

  // 同步落盘：此刻模型还没回来，但条目已经存在且是规则分。
  assert.equal(db.current().length, 1, "同步落盘不能等模型");
  assert.equal(stored.importance, 10, "答错 → 规则分 10");
  assert.equal(stored.importanceSource, "rule");
  assert.equal(stored.importanceDegraded, true);

  const upgraded = updateEpisodeImportance({
    write: db.write,
    read: db.read,
    userId: "u",
    id: episodeId(stored),
    modelImportance: 7,
  });
  assert.ok(upgraded);
  assert.equal(upgraded.importance, 7);
  assert.equal(upgraded.importanceSource, "model");
  assert.equal(upgraded.importanceDegraded, false);
  assert.equal(upgraded.importanceDegradedReason, undefined);
  assert.equal(db.current().length, 1, "升级是就地更新，不新增条目");
});

test("重要度升级：条目已被容量上限淘汰 → 返回 null，不重建", () => {
  const db = episodeStore();
  const facts = buildFacts({ mastery: {}, attemptCounts: { gaming: 1 } });
  const ev = event({ questionId: "u2", correct: true, at: NOW });

  const stored = recordNpcEpisode({
    write: db.write,
    read: db.read,
    userId: "u",
    event: ev,
    facts,
    importance: null,
  });
  const id = episodeId(stored);

  // 模拟容量淘汰：写入时该条目已不在列表里。
  db.write([]);
  const result = updateEpisodeImportance({
    write: db.write,
    read: db.read,
    userId: "u",
    id,
    modelImportance: 9,
  });

  assert.equal(result, null, "找不到条目时不得凭空重建");
  assert.equal(db.current().length, 0, "淘汰的条目不能被复活");
});

test("重要度升级：模型失败不改分，只更新降级原因", () => {
  const db = episodeStore();
  const facts = buildFacts({ mastery: {}, attemptCounts: { gaming: 1 } });
  const ev = event({ questionId: "u3", correct: false, at: NOW });

  const stored = recordNpcEpisode({
    write: db.write,
    read: db.read,
    userId: "u",
    event: ev,
    facts,
    importance: null,
    importanceDegradedReason: "模型重要度尚未返回，先按规则分落盘",
  });
  const ruleScore = stored.importance;

  const updated = updateEpisodeImportance({
    write: db.write,
    read: db.read,
    userId: "u",
    id: episodeId(stored),
    modelImportance: null,
    degradedReason: "重要度服务不可用（HTTP 500）",
  });

  assert.ok(updated);
  assert.equal(updated.importance, ruleScore, "模型失败不得改动规则分");
  assert.equal(updated.importanceSource, "rule");
  assert.equal(updated.importanceDegraded, true);
  assert.equal(updated.importanceDegradedReason, "重要度服务不可用（HTTP 500）");
});

// ---------------------------------------------------------------- 记忆展示（P1）

/** 让 gaming 稳定成为最弱域的 facts（记忆展示用）。 */
function memoryFacts(): NpcFacts {
  return {
    ...emptyFacts(),
    mastery: { gaming: 0, tech: 10 },
    wrongCounts: { gaming: 2 },
    attemptCounts: { gaming: 2, tech: 2 },
    lastSeenAt: { gaming: NOW - 86400000, tech: NOW - 86400000 },
    touchedDomains: 2,
  };
}

function memoryEpisodes(): ReturnType<typeof toEpisode>[] {
  return [
    toEpisode({
      event: event({
        questionId: "g1",
        domain: "gaming" as AnswerEvent["domain"],
        topic: "主机与PC",
        correct: false,
        at: NOW - 3 * 86400000,
      }),
      isNewDomain: false,
    }),
    toEpisode({
      event: event({
        questionId: "g1",
        domain: "gaming" as AnswerEvent["domain"],
        topic: "主机与PC",
        correct: true,
        at: NOW - 4 * 86400000,
      }),
      isNewDomain: false,
    }),
    toEpisode({
      event: event({
        questionId: "g2",
        domain: "gaming" as AnswerEvent["domain"],
        topic: "手游",
        correct: false,
        at: NOW - 86400000,
      }),
      isNewDomain: false,
    }),
    toEpisode({
      event: event({
        questionId: "g3",
        domain: "gaming" as AnswerEvent["domain"],
        topic: "赛事",
        correct: false,
        at: NOW - 2 * 86400000,
      }),
      isNewDomain: false,
    }),
  ];
}

test("记忆：最多 2 条，同题多次作答只留一条", () => {
  const memories = selectMemories({
    episodes: memoryEpisodes(),
    domain: "gaming",
    now: NOW,
  });
  assert.equal(memories.length, 2);
  assert.equal(new Set(memories.map((m) => m.questionId)).size, 2);
});

test("记忆：同一知识点重复答错只展示一次（避免两行完全一样）", () => {
  const episodes = ["g1", "g2"].map((id) =>
    toEpisode({
      event: event({
        questionId: id,
        domain: "gaming" as AnswerEvent["domain"],
        topic: "主机与PC",
        correct: false,
        at: NOW - 86400000,
      }),
      isNewDomain: false,
    })
  );
  const memories = selectMemories({ episodes, domain: "gaming", now: NOW });
  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.topic, "主机与PC");
});

test("记忆理由中文化：无英文域 id、无内部检索术语", () => {
  const episode = toEpisode({
    event: event({
      questionId: "g1",
      domain: "gaming" as AnswerEvent["domain"],
      topic: "主机与PC",
      correct: false,
      at: NOW - 3 * 86400000,
    }),
    isNewDomain: false,
  });
  const reason = formatMemoryReason(episode, NOW);
  assert.equal(reason, "「游戏 · 主机与PC」答错过 · 3 天前");
  assert.ok(!reason.includes("gaming"));
  assert.ok(!/同域|跨域|难度匹配|近期/.test(reason));
});

test("记忆理由：今天 / 昨天 / 未来时间按今天", () => {
  const base = { domain: "gaming" as DomainId, topic: "主机与PC", correct: true };
  assert.equal(
    formatMemoryReason({ ...base, at: NOW - 3600_000 }, NOW),
    "「游戏 · 主机与PC」答对过 · 今天"
  );
  assert.equal(
    formatMemoryReason({ ...base, at: NOW - 86400000 }, NOW),
    "「游戏 · 主机与PC」答对过 · 昨天"
  );
  assert.equal(
    formatMemoryReason({ ...base, at: NOW + 5000 }, NOW),
    "「游戏 · 主机与PC」答对过 · 今天"
  );
});

test("decideNpc 缺省计算 memories；显式传入时不被覆盖", () => {
  const context = ctx({ facts: memoryFacts(), episodes: memoryEpisodes() });
  const auto = decideNpc({ context, commentary: "台词" });
  assert.equal(auto.memories?.length, 2);
  assert.equal(auto.memories?.[0]?.domain, "gaming");

  const explicit = decideNpc({ context, commentary: "台词", memories: [] });
  assert.deepEqual(explicit.memories, []);
});

test("prompt 含记忆；无记忆不追加噪声", async () => {
  const prompts: string[] = [];
  const model = {
    name: "stub",
    generate: async (prompt: string) => {
      prompts.push(prompt);
      return "台词";
    },
  };

  await narrate({
    context: ctx({ facts: memoryFacts(), episodes: memoryEpisodes() }),
    model,
  });
  assert.ok(prompts[0]?.includes("你记得这些事"));
  assert.ok(prompts[0]?.includes("「游戏 · 手游」答错过 · 昨天"));

  await narrate({ context: ctx({ facts: memoryFacts(), episodes: [] }), model });
  assert.ok(!prompts[1]?.includes("你记得这些事"));
});

test("requestCoach：服务端 memories 优先，缺省/非法回退，空数组不回退", async () => {
  const originalFetch = globalThis.fetch;
  const episodes = memoryEpisodes();
  const facts = memoryFacts();
  const call = () =>
    requestCoach({
      userId: "u-mem",
      domains: ["gaming", "tech"] as NpcContext["domains"],
      facts,
      episodes,
      seed: 1,
      now: NOW,
    });
  const body = (memories: unknown) =>
    JSON.stringify({
      commentary: "台词",
      degraded: false,
      rationale: "依据",
      domainOrder: ["gaming", "tech"],
      weights: { gaming: 1, tech: 0.2 },
      provider: "stub",
      ...(memories === undefined ? {} : { memories }),
    });

  try {
    const valid = [
      {
        questionId: "g1",
        domain: "gaming",
        topic: "主机与PC",
        correct: false,
        at: NOW - 3 * 86400000,
        reason: "「游戏 · 主机与PC」答错过 · 3 天前",
      },
    ];
    globalThis.fetch = (async () =>
      new Response(body(valid), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    assert.equal((await call()).decision.memories?.length, 1);

    globalThis.fetch = (async () =>
      new Response(body(undefined), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    assert.equal((await call()).decision.memories?.length, 2, "旧服务端 → 本地回退");

    globalThis.fetch = (async () =>
      new Response(body("invalid"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    assert.equal((await call()).decision.memories?.length, 2, "非法结构 → 本地回退");

    globalThis.fetch = (async () =>
      new Response(body([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
    assert.equal((await call()).decision.memories?.length, 0, "空数组是权威结果");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("重要度探测：没有点评时首题探一次，失败即停", async () => {
  resetNpcModelStateForTest();
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({ importance: null, degraded: true, degradedReason: "未配置模型端点" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await recordCoachEvent({
      userId: "u-probe",
      event: event({ questionId: "probe-1" }),
      facts: emptyFacts(),
    });
    await recordCoachEvent({
      userId: "u-probe",
      event: event({ questionId: "probe-2" }),
      facts: emptyFacts(),
    });
  } finally {
    globalThis.fetch = originalFetch;
    resetNpcModelStateForTest();
  }

  assert.equal(calls.length, 1, "首次探测失败后不应每题重试");
  assert.ok(calls[0]?.endsWith("/api/npc/importance"));
  assert.equal(loadCoachEpisodes("u-probe").length, 2);
});

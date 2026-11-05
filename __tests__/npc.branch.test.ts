/**
 * NPC 结算后策略分支 · 单元测试
 *
 * 覆盖：策略选项、两步计划、次日回执、旧数据归一、promise 只进台词、
 * 以及第 5 题的三种选题策略（默认行为仍由 npc.test.ts 守）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildBranchOptions,
  buildBranchTemplate,
  buildCommentary,
  buildDailyPlan,
  buildPracticeReceipt,
  decideNpc,
  formatPromiseLine,
  narrate,
  normalizeDailyChoice,
  pickPracticeQuestion,
} from "../lib/npc";
import { getRecentDailyChoice, saveDailyChoice, saveDailySession } from "../lib/storage";
import type { DailyChoice, DailySession, DomainId, Question } from "../types";
import type { NpcContext, NpcFacts, NpcPromise } from "../lib/npc/types";

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

function facts(over: Partial<NpcFacts> = {}): NpcFacts {
  return {
    mastery: { gaming: 0, tech: 5, history: 10 },
    topicMastery: {
      "gaming|T1": 0,
      "gaming|T2": 2,
      "tech|T1": 1,
      "tech|T2": 4,
      "history|T1": 6,
      "history|T2": 8,
    },
    wrongCounts: { gaming: 3, tech: 1 },
    attemptCounts: { gaming: 3, tech: 2, history: 2 },
    lastSeenAt: { gaming: NOW - 86_400_000, tech: NOW - 86_400_000, history: NOW - 86_400_000 },
    touchedDomains: 3,
    ...over,
  };
}

function ctx(over: Partial<NpcContext> = {}): NpcContext {
  return {
    userId: "u-branch",
    domains: ["gaming", "tech", "history"],
    pool: {
      gaming: [q("g1", "gaming", "T1", 2), q("g2", "gaming", "T2", 1)],
      tech: [q("t1", "tech", "T1", 3), q("t2", "tech", "T2", 1)],
      history: [q("h1", "history", "T1", 2), q("h2", "history", "T2", 1)],
    } as NpcContext["pool"],
    facts: facts(),
    episodes: [],
    seed: 42,
    now: NOW,
    ...over,
  };
}

function choice(over: Partial<DailyChoice> = {}): DailyChoice {
  return {
    option: "continue-weak",
    label: "继续补最弱项",
    chosenAt: NOW,
    reply: "好，接下来先把「游戏」再过一遍。",
    replyStatus: "template",
    ...over,
  };
}

test("策略选项：固定文案 + 今日落点提示，同上下文同结果", () => {
  const meta = buildBranchOptions(ctx());
  assert.deepEqual(
    meta.options.map((o) => o.id),
    ["continue-weak", "switch-easy", "follow-teacher"]
  );
  assert.equal(meta.weakestDomain, "gaming");
  assert.equal(meta.secondDomain, "tech");
  assert.equal(meta.easyDomain, "history");
  assert.equal(meta.weakTopic, "T1");
  assert.equal(meta.options[0]?.label, "继续补最弱项");
  assert.equal(meta.options[0]?.hint, "今天：游戏");
  assert.equal(meta.options[1]?.hint, "今天：历史·文化");
  assert.equal(meta.options[2]?.hint, "由老师挑");
  assert.deepEqual(buildBranchOptions(ctx()), meta);

  for (const option of meta.options) {
    assert.ok(option.label.length <= 20, option.label);
    assert.ok(!/[a-z]{4,}/.test(option.label), option.label);
    assert.ok(!/[a-z]{4,}/.test(option.hint ?? ""), option.hint);
  }
});

test("策略选项：单域时轻松选项降级、不再给域提示", () => {
  const meta = buildBranchOptions(
    ctx({
      domains: ["gaming"],
      facts: facts({ mastery: { gaming: 0 }, attemptCounts: { gaming: 1 } }),
    })
  );
  assert.equal(meta.easyDomain, undefined);
  assert.equal(meta.secondDomain, undefined);
  const swap = meta.options.find((o) => o.id === "switch-easy");
  assert.equal(swap?.label, "换个轻松领域");
  assert.equal(swap?.hint, undefined);
});

test("计划：三种策略各 2 步，continue 带 topic、follow 用第二弱域", () => {
  const meta = buildBranchOptions(ctx());

  const cont = buildDailyPlan({
    option: "continue-weak",
    ...(meta.weakestDomain ? { weakestDomain: meta.weakestDomain } : {}),
    ...(meta.weakTopic ? { weakTopic: meta.weakTopic } : {}),
  });
  assert.equal(cont.title, "下次这样练");
  assert.equal(cont.steps.length, 2);
  assert.equal(cont.targetDomain, "gaming");
  assert.equal(cont.targetTopic, "T1");
  assert.ok(cont.steps[0]?.includes("游戏 · T1"));

  const swap = buildDailyPlan({
    option: "switch-easy",
    ...(meta.weakestDomain ? { weakestDomain: meta.weakestDomain } : {}),
    ...(meta.easyDomain ? { easyDomain: meta.easyDomain } : {}),
  });
  assert.equal(swap.targetDomain, "history");
  assert.ok(swap.steps[0]?.includes("历史"));
  assert.ok(swap.steps[1]?.includes("游戏"));

  const follow = buildDailyPlan({
    option: "follow-teacher",
    ...(meta.secondDomain ? { secondDomain: meta.secondDomain } : {}),
    ...(meta.weakestDomain ? { weakestDomain: meta.weakestDomain } : {}),
  });
  assert.equal(follow.targetDomain, "tech");
  assert.ok(follow.steps[0]?.includes("科技"));

  for (const plan of [cont, swap, follow]) {
    assert.equal(plan.steps.length, 2);
    assert.ok(plan.steps.every((s) => s.length > 0));
  }
});

test("计划：缺 topic 时降级为域级动作，不编造知识点", () => {
  const plan = buildDailyPlan({ option: "continue-weak", weakestDomain: "gaming" });
  assert.ok(plan.steps[0]?.includes("「游戏」"));
  assert.equal(plan.targetTopic, undefined);
});

test("回执：完成 / 答错 / 跳过 / 未作答；无承诺不渲染", () => {
  const promise: NpcPromise = {
    date: "2026-11-04",
    option: "switch-easy",
    label: "换个轻松领域",
  };
  const base = { promise, practiceReason: "按昨天约定：换轻松的「历史·文化」，先做简单题" };

  assert.ok(buildPracticeReceipt({ ...base, practiceCorrect: true })?.endsWith("· 完成"));
  assert.ok(buildPracticeReceipt({ ...base, practiceCorrect: false })?.endsWith("· 完成（答错）"));
  assert.ok(buildPracticeReceipt({ ...base, practiceSkipped: true })?.endsWith("· 已跳过"));
  assert.ok(buildPracticeReceipt({ ...base, practiceCorrect: null })?.endsWith("· 未作答"));
  assert.equal(buildPracticeReceipt({ practiceCorrect: true }), null);
});

test("旧数据归一：pending → template，缺计划时补通用两步", () => {
  const normalized = normalizeDailyChoice(choice({ replyStatus: "pending" }));
  assert.equal(normalized.replyStatus, "template");
  assert.ok(normalized.plan);
  assert.equal(normalized.plan?.steps.length, 2);

  const model = normalizeDailyChoice(
    choice({ replyStatus: "model", reply: "旧模型台词", label: "继续补「游戏」" })
  );
  assert.equal(model.replyStatus, "model");
  assert.equal(model.reply, "旧模型台词");
});

test("承诺措辞：统一用“上次结算时”，不出现“明天”", () => {
  const promise: NpcPromise = {
    date: "2026-11-04",
    option: "continue-weak",
    label: "继续补最弱项",
  };
  assert.equal(formatPromiseLine(promise), "上次结算时你选了继续补最弱项");
  assert.ok(!formatPromiseLine(promise).includes("明天"));
});

test("promise 只进台词：domainOrder / questionOrder 完全不变", () => {
  const promise: NpcPromise = {
    date: "2026-11-04",
    option: "switch-easy",
    label: "换个轻松领域",
  };
  const plain = decideNpc({ context: ctx(), commentary: "台词" });
  const withPromise = decideNpc({ context: ctx({ promise }), commentary: "台词" });
  assert.deepEqual(withPromise.domainOrder, plain.domainOrder);
  assert.deepEqual(withPromise.questionOrder, plain.questionOrder);
});

test("promise 进入降级模板，无 promise 时旧文案逐字不变", () => {
  const base = buildCommentary(ctx());
  const promised = buildCommentary(
    ctx({ promise: { date: "2026-11-04", option: "continue-weak", label: "继续补最弱项" } })
  );
  assert.equal(buildCommentary(ctx()), base);
  assert.ok(promised.startsWith(base));
  assert.ok(promised.includes("上次结算时你选了继续补最弱项"));
});

test("promise 进入点评 prompt；模型漏提时补半句", async () => {
  const prompts: string[] = [];
  const promise: NpcPromise = {
    date: "2026-11-04",
    option: "follow-teacher",
    label: "听老师安排",
  };
  const model = {
    name: "stub",
    generate: async (prompt: string) => {
      prompts.push(prompt);
      return "今天先补短板。";
    },
  };
  const result = await narrate({ context: ctx({ promise }), model });
  assert.ok(prompts[0]?.includes("上次结算时你选了听老师安排"));
  assert.ok(result.decision.commentary.includes("上次你选了听老师安排"));

  const already = await narrate({
    context: ctx({ promise }),
    model: { name: "stub", generate: async () => "上次你选了听老师安排，今天继续。" },
  });
  assert.equal(already.decision.commentary, "上次你选了听老师安排，今天继续。");
});

test("第 5 题策略：switch-easy 换到最省练域并优先难度 1", () => {
  const pick = pickPracticeQuestion({
    context: ctx(),
    excludeIds: new Set(),
    focus: { strategy: "switch-easy" },
  });
  assert.equal(pick?.question.id, "h2");
  assert.match(pick?.reason ?? "", /换轻松的「历史·文化」/);
});

test("第 5 题策略：follow-teacher 用第二弱域，continue 优先昨日 topic", () => {
  const follow = pickPracticeQuestion({
    context: ctx(),
    excludeIds: new Set(),
    focus: { strategy: "follow-teacher" },
  });
  assert.equal(follow?.question.id, "t1");
  assert.match(follow?.reason ?? "", /按老师安排/);

  const cont = pickPracticeQuestion({
    context: ctx(),
    excludeIds: new Set(),
    focus: { strategy: "continue-weak", domain: "gaming", topic: "T2" },
  });
  assert.equal(cont?.question.id, "g2");
  assert.match(cont?.reason ?? "", /继续补「游戏」的「T2」/);
});

test("第 5 题策略：topic 不在今日候选 / 候选耗尽时回落默认", () => {
  const absent = pickPracticeQuestion({
    context: ctx(),
    excludeIds: new Set(),
    focus: { strategy: "continue-weak", domain: "gaming", topic: "不存在" },
  });
  assert.equal(absent?.question.id, "g1");
  assert.match(absent?.reason ?? "", /你在游戏错了 3 次/);

  const exhausted = pickPracticeQuestion({
    context: ctx(),
    excludeIds: new Set(["g1", "g2", "t1", "t2", "h1", "h2"]),
    focus: { strategy: "switch-easy" },
  });
  assert.equal(exhausted, undefined);
});

test("次日引用：只读 7 天内最近一次选择", () => {
  const session = (date: string, patch: Partial<DailySession> = {}): DailySession => ({
    date,
    domains: ["gaming"],
    questionIds: ["q1"],
    done: true,
    ...patch,
  });

  saveDailySession(session("2032-06-01"));
  saveDailySession(session("2032-06-08", { choice: choice() }));

  assert.equal(getRecentDailyChoice("2032-06-09")?.date, "2032-06-08");
  assert.equal(getRecentDailyChoice("2032-06-15")?.date, "2032-06-08");
  assert.equal(getRecentDailyChoice("2032-06-16"), null);

  saveDailyChoice("2032-06-08", choice({ replyStatus: "template", plan: undefined }));
  assert.equal(getRecentDailyChoice("2032-06-09")?.choice.replyStatus, "template");
});

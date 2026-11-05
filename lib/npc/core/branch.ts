/**
 * NPC 引擎 · 结算后叙事分支（纯函数）
 *
 * 三个固定策略 + 确定性计划。**只影响台词与第 5 题选题策略**：
 * 前 4 题、计分、duel/PK 都不受影响。
 *
 * 选项文案固定为策略名，具体域放在 `hint` —— 次日领域轮换后，
 * “继续补最弱项”仍然成立，不会出现“说好补历史、明天却没抽到历史”的假承诺。
 */

import { domainName } from "@/content/domains";
import type { BranchOptionId, DailyChoice, DailyPlan, DomainId } from "@/types";

import type { DecisionMemory, NpcContext, NpcPromise } from "../types";
import { rankDomains } from "./policy";

/** 选项文案上限（与 ui-system 的短文案约定一致）。 */
const LABEL_MAX = 20;

export interface BranchOption {
  readonly id: BranchOptionId;
  readonly label: string;
  /** 今天的落点提示，如「今天：历史·文化」。 */
  readonly hint?: string;
  /** 生成计划时今天指向的领域；次日仅作加权。 */
  readonly domain?: DomainId;
}

export interface BranchMeta {
  readonly weakestDomain?: DomainId;
  readonly easyDomain?: DomainId;
  readonly secondDomain?: DomainId;
  readonly weakTopic?: string;
  readonly options: readonly BranchOption[];
}

/**
 * 由当前 NPC 上下文生成三个策略选项。
 *
 * 序位全部取自 `rankDomains`（与点评同一权威）：
 * 0 = 最弱，末位 = 最省练，1 = 第二弱。
 */
export function buildBranchOptions(context: NpcContext): BranchMeta {
  const order = rankDomains(context);
  const weakestDomain = order[0];
  const secondDomain = order[1];
  const easyDomain = order.length > 1 ? order[order.length - 1] : undefined;
  const weakTopic = weakestDomain ? lowestTopic(context, weakestDomain) : undefined;

  const options: BranchOption[] = [
    {
      id: "continue-weak",
      label: "继续补最弱项",
      ...(weakestDomain
        ? { hint: clip(`今天：${domainName(weakestDomain)}`), domain: weakestDomain }
        : {}),
    },
    {
      id: "switch-easy",
      label: "换个轻松领域",
      ...(easyDomain ? { hint: clip(`今天：${domainName(easyDomain)}`), domain: easyDomain } : {}),
    },
    { id: "follow-teacher", label: "听老师安排", ...(secondDomain ? { hint: "由老师挑" } : {}) },
  ];

  return {
    ...(weakestDomain ? { weakestDomain } : {}),
    ...(easyDomain ? { easyDomain } : {}),
    ...(secondDomain ? { secondDomain } : {}),
    ...(weakTopic ? { weakTopic } : {}),
    options,
  };
}

/** 结算后立即生成的确定性两步计划（不调模型）。 */
export function buildDailyPlan(params: {
  readonly option: BranchOptionId;
  readonly weakestDomain?: DomainId;
  readonly easyDomain?: DomainId;
  readonly secondDomain?: DomainId;
  readonly weakTopic?: string;
}): DailyPlan {
  const weak = params.weakestDomain;
  const easy = params.easyDomain;

  if (params.option === "switch-easy") {
    return {
      strategy: params.option,
      title: "下次这样练",
      steps: [
        easy
          ? `下次加练换到「${domainName(easy)}」，只做难度 1`
          : "下次加练换个轻松题型，只做难度 1",
        weak ? `先不碰「${domainName(weak)}」` : "先不碰今天最难的题",
      ],
      ...(easy ? { targetDomain: easy } : {}),
    };
  }

  if (params.option === "follow-teacher") {
    const target = params.secondDomain ?? weak;
    return {
      strategy: params.option,
      title: "下次这样练",
      steps: [
        target ? `下次从「${domainName(target)}」开始` : "下次由老师挑一道加练",
        "先补老师挑的最低知识点",
      ],
      ...(target ? { targetDomain: target } : {}),
    };
  }

  const where = weak
    ? params.weakTopic
      ? `${domainName(weak)} · ${params.weakTopic}`
      : domainName(weak)
    : undefined;
  return {
    strategy: params.option,
    title: "下次这样练",
    steps: [
      where ? `把「${where}」的错题再过一遍` : "把今天最弱的错题再过一遍",
      "下次加练先按最弱项出 1 题",
    ],
    ...(weak ? { targetDomain: weak } : {}),
    ...(params.weakTopic ? { targetTopic: params.weakTopic } : {}),
  };
}

/**
 * 次日回执：把“昨天的约定”和“今天实际练了什么”对上。
 *
 * 无昨日承诺返回 null（不渲染空块）。
 */
export function buildPracticeReceipt(params: {
  readonly promise?: NpcPromise;
  readonly practiceReason?: string | null;
  readonly practiceCorrect?: boolean | null;
  readonly practiceSkipped?: boolean;
}): string | null {
  if (!params.promise) return null;
  const result = params.practiceSkipped
    ? "已跳过"
    : params.practiceCorrect === true
      ? "完成"
      : params.practiceCorrect === false
        ? "完成（答错）"
        : "未作答";
  const practiced = params.practiceReason ?? "今天没有加练题";
  return `昨天你说：${params.promise.label}。今天加练：${practiced} · ${result}`;
}

/**
 * 兼容旧数据：旧 pending 归一为 template（原文就是模板）；
 * 缺 plan 时按策略补一个通用计划。
 */
export function normalizeDailyChoice(choice: DailyChoice): DailyChoice {
  const next: DailyChoice = {
    ...choice,
    replyStatus: choice.replyStatus === "pending" ? "template" : choice.replyStatus,
  };
  if (!next.plan) {
    next.plan =
      next.option === "switch-easy"
        ? buildDailyPlan({
            option: next.option,
            ...(next.domain ? { easyDomain: next.domain } : {}),
          })
        : buildDailyPlan({
            option: next.option,
            ...(next.domain ? { weakestDomain: next.domain } : {}),
          });
  }
  return next;
}

/**
 * 即时老师回应（不再调模型）。
 *
 * 同输入 → 同输出；有记忆时最多追加一句，不逐条复述。
 */
export function buildBranchTemplate(params: {
  readonly option: BranchOptionId;
  readonly weakestDomain?: DomainId;
  readonly easyDomain?: DomainId;
  readonly secondDomain?: DomainId;
  readonly memory?: DecisionMemory;
}): string {
  const weak = params.weakestDomain ? `「${domainName(params.weakestDomain)}」` : "短板";
  const second = params.secondDomain ?? params.weakestDomain;

  if (params.option === "switch-easy") {
    const head = params.easyDomain
      ? `行，接下来换「${domainName(params.easyDomain)}」松一松。`
      : "行，接下来换个轻松的题型。";
    return params.weakestDomain ? `${head}${weak}我替你留着。` : head;
  }

  if (params.option === "follow-teacher") {
    return second
      ? `那就按我的来：接下来先从「${domainName(second)}」开始。`
      : "那就按我的来，接下来听我安排。";
  }

  const head = params.weakestDomain
    ? `好，接下来先把${weak}再过一遍。`
    : "好，接下来继续保持今天的节奏。";
  return params.memory ? `${head}上次「${params.memory.topic}」答错过，正好接上。` : head;
}

/**
 * 次日台词的统一措辞（点评 prompt 与模板共用，避免两套说法）。
 */
export function formatPromiseLine(promise: NpcPromise): string {
  return `上次结算时你选了${promise.label}`;
}

/** 域内 topic 熟练度最低的一项；无记录返回 undefined（不编造）。 */
function lowestTopic(context: NpcContext, domain: DomainId): string | undefined {
  const prefix = `${domain}|`;
  let best: { topic: string; value: number } | undefined;
  for (const [key, value] of Object.entries(context.facts.topicMastery ?? {})) {
    if (!key.startsWith(prefix)) continue;
    const topic = key.slice(prefix.length);
    if (!topic) continue;
    if (
      !best ||
      value < best.value ||
      (value === best.value && topic.localeCompare(best.topic) < 0)
    ) {
      best = { topic, value };
    }
  }
  return best?.topic;
}

/** 超长时截断，保证按钮一行放得下（中文按字符计）。 */
function clip(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

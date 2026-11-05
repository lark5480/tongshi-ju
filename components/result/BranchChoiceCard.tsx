"use client";

import { MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { buildPracticeReceipt, type BranchOption } from "@/lib/npc";
import type { NpcPromise } from "@/lib/npc/types";
import type { BranchOptionId, DailyChoice, DailyPlan } from "@/types";

/** 旧数据里的降级原因 → 玩家可读文案。 */
function degradedLabel(reason?: string): string {
  if (!reason) return "模型不可用，以下为确定性模板";
  if (reason.includes("未配置")) return "未配置模型，以下为确定性模板";
  return `模型调用失败，已降级为确定性模板：${reason}`;
}

/**
 * 结算后的“接下来怎么练”卡。
 *
 * 顺序：昨日回执 → 今日选择（即时模板）→ 两步计划。
 * 新选择不再请求模型；旧 `degraded` 数据仍显式标注。
 */
export function BranchChoiceCard(props: {
  readonly options: readonly BranchOption[];
  readonly choice: DailyChoice | null;
  readonly onChoose: (option: BranchOptionId) => void;
  readonly previous?: { date: string; choice: DailyChoice } | null;
  readonly practice?: {
    readonly reason: string | null;
    readonly correct: boolean | null;
    readonly skipped: boolean;
  };
}) {
  const { options, choice, onChoose, previous, practice } = props;

  const promise: NpcPromise | undefined = previous
    ? {
        date: previous.date,
        option: previous.choice.option,
        label: previous.choice.label,
        ...(previous.choice.domain ? { domain: previous.choice.domain } : {}),
      }
    : undefined;
  const receipt = buildPracticeReceipt({
    ...(promise ? { promise } : {}),
    practiceReason: practice?.reason ?? null,
    practiceCorrect: practice?.correct ?? null,
    practiceSkipped: practice?.skipped ?? false,
  });

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
        <MessageCircle size={13} className="text-accent" aria-hidden />
        接下来怎么练？
      </div>

      {receipt && (
        <p className="rounded-md bg-surface-2 px-2.5 py-2 text-xs text-muted" aria-live="polite">
          {receipt}
        </p>
      )}

      {choice ? (
        <div className="space-y-2" aria-live="polite">
          <div className="space-y-1">
            <p className="text-xs text-dim">已选择</p>
            <p className="break-words text-sm font-semibold">{choice.label}</p>
            <p className="break-words text-sm text-muted">{choice.reply}</p>
          </div>

          {choice.plan && <PlanSteps plan={choice.plan} />}

          {choice.replyStatus === "degraded" && (
            <p className="text-xs text-dim">（{degradedLabel(choice.degradedReason)}）</p>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted">今天先练到这里。接下来想怎么走？</p>
          <div className="flex flex-col gap-2">
            {options.map((option) => (
              <Button
                key={option.id}
                variant="secondary"
                block
                onClick={() => onChoose(option.id)}
                className="min-w-0"
              >
                <span className="flex min-w-0 flex-col items-center gap-0.5">
                  <span className="break-words">{option.label}</span>
                  {option.hint && (
                    <span className="text-xs font-normal text-muted">{option.hint}</span>
                  )}
                </span>
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PlanSteps({ plan }: { plan: DailyPlan }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-fg">{plan.title}</p>
      <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted">
        {plan.steps.map((step) => (
          <li key={step} className="break-words">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}

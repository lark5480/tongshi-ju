"use client";

import { Check, X } from "lucide-react";

import type { Question } from "@/types";
import { domainColor, domainName } from "@/content/domains";
import { domainIcon } from "@/components/domain/DomainCard";
import { Button } from "@/components/ui/Button";

interface QuestionCardProps {
  question: Question;
  /** 已选答案（多选为数组）。 */
  picked: string | string[];
  /** 是否已提交。 */
  submitted: boolean;
  /** 当前题剩余毫秒。 */
  remaining: number;
  /** 总限时（毫秒）。 */
  limit: number;
  onPick: (option: string) => void;
  onConfirm: () => void;
}

/**
 * 题目卡 —— 最高频组件，也是「手感」的主要载体。
 *
 * 状态反馈是**三重线索**（颜色 + 图标 + 文案），不靠颜色单独承载信息：
 * - 答对：绿色描边 + ✓ 图标 + "答对了"；
 * - 答错：红色描边 + ✗ 图标 + "答错了" + 轻微抖动；
 * - 正确项始终高亮，即使玩家没选它。
 *
 * 倒计时颜色分三档：>10s 领域色 / ≤10s 琥珀 / ≤5s 玫红 + 缩放脉冲。
 */
export function QuestionCard({
  question,
  picked,
  submitted,
  remaining,
  limit,
  onPick,
  onConfirm,
}: QuestionCardProps) {
  const color = domainColor(question.domain);
  const DomainGlyph = domainIcon(question.domain);
  const pickedList = Array.isArray(picked) ? picked : picked ? [picked] : [];
  const answerList = Array.isArray(question.answer) ? question.answer : [question.answer];
  const ratio = limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : 0;
  const urgent = remaining > 0 && remaining <= 5000;
  const warning = remaining > 0 && remaining <= 10000;
  const isMulti = question.type === "multi";
  const hit = pickedList.some((p) => answerList.includes(p));

  /** 选项状态：未提交时不标记；提交后标出正确/错误。 */
  const optionState = (opt: string): "correct" | "wrong" | "dimmed" | undefined => {
    if (!submitted) return undefined;
    if (answerList.includes(opt)) return "correct";
    if (pickedList.includes(opt)) return "wrong";
    return "dimmed";
  };

  return (
    <div className="space-y-4">
      {/* 领域胶囊 + 倒计时 */}
      <div className="flex items-center justify-between gap-3">
        <span
          className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium"
          style={{ background: `${color}1f`, color, boxShadow: `inset 0 0 0 1px ${color}44` }}
        >
          <span aria-hidden>
            <DomainGlyph size={13} strokeWidth={2.2} />
          </span>
          {domainName(question.domain)}
          <span className="opacity-70">· {question.topic}</span>
        </span>

        <span
          className={`tabular text-sm font-semibold ${
            urgent ? "animate-pulse-soft text-danger" : warning ? "text-gold" : "text-muted"
          }`}
          aria-live="polite"
          aria-label={submitted ? "已提交" : `剩余 ${Math.ceil(remaining / 1000)} 秒`}
        >
          {submitted ? "—" : `${Math.ceil(remaining / 1000)}s`}
        </span>
      </div>

      {/* 剩余时间条：用 scaleX 动画，不动 width，避免布局抖动 */}
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
        <div
          className="h-full w-full origin-left rounded-pill transition-transform duration-200 ease-linear"
          style={{
            transform: `scaleX(${ratio})`,
            background: urgent ? "#FB7185" : warning ? "#FFC24B" : color,
          }}
        />
      </div>

      {/* 题干 */}
      <h2 className="text-[18px] font-semibold leading-[1.7]">{question.stem}</h2>

      {/* 选项 */}
      <div className="space-y-2">
        {question.options.map((opt) => {
          const state = optionState(opt);
          const isPicked = pickedList.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              className={`option-btn ${
                state === "wrong" ? "animate-shake" : state === "correct" ? "animate-pop-in" : ""
              }`}
              data-state={state}
              disabled={submitted}
              onClick={() => onPick(opt)}
            >
              {/* 领域色左条：一眼看出"这题属于哪块" */}
              <span
                aria-hidden
                className="absolute inset-y-2 left-0 w-[3px] rounded-full"
                style={{ background: color, opacity: state === "dimmed" ? 0.18 : 0.55 }}
              />
              <span className="flex items-center gap-3">
                {isMulti && (
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] ${
                      isPicked ? "border-accent bg-accent text-white" : "border-border-strong"
                    }`}
                    aria-hidden
                  >
                    {isPicked ? <Check size={12} strokeWidth={3} /> : null}
                  </span>
                )}
                <span className="flex-1">{opt}</span>
                {state === "correct" && (
                  <Check size={18} className="shrink-0 text-success" aria-hidden />
                )}
                {state === "wrong" && <X size={18} className="shrink-0 text-danger" aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>

      {/* 多选题需要二次确认 */}
      {isMulti && !submitted && (
        <Button block onClick={onConfirm} disabled={pickedList.length === 0}>
          确认作答（已选 {pickedList.length} 项）
        </Button>
      )}

      {/* 解析 */}
      {submitted && (
        <div
          className="panel animate-fade-in overflow-hidden"
          style={{ borderLeft: `3px solid ${color}` }}
        >
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
              {hit ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check size={16} strokeWidth={2.6} aria-hidden />
                  答对了
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-danger">
                  <X size={16} strokeWidth={2.6} aria-hidden />
                  答错了
                </span>
              )}
              <span className="font-normal text-muted">正确答案：{answerList.join("、")}</span>
            </div>
            <p className="text-[15px] leading-[1.65] text-fg/75">{question.explanation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

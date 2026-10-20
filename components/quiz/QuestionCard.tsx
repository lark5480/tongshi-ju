"use client";

import type { Question } from "@/types";
import { domainColor, domainEmoji, domainName } from "@/content/domains";
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

/** 题目卡：题干、倒计时、选项、解析。 */
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
  const pickedList = Array.isArray(picked) ? picked : picked ? [picked] : [];
  const answerList = Array.isArray(question.answer) ? question.answer : [question.answer];
  const ratio = limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : 0;
  const urgent = remaining > 0 && remaining <= 5000;

  /** 选项状态：未提交时不标记；提交后标出正确/错误。 */
  const optionState = (opt: string): string | undefined => {
    if (!submitted) return undefined;
    if (answerList.includes(opt)) return "correct";
    if (pickedList.includes(opt)) return "wrong";
    return "dimmed";
  };

  return (
    <div className="space-y-4">
      {/* 领域标签 + 倒计时 */}
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ background: `${color}22`, color }}
        >
          <span aria-hidden>{domainEmoji(question.domain)}</span>
          {domainName(question.domain)}
          <span className="opacity-70">· {question.topic}</span>
        </span>

        <span
          className={`tabular text-sm font-semibold ${urgent ? "text-danger" : "text-muted"}`}
          aria-live="polite"
        >
          {submitted ? "—" : `${Math.ceil(remaining / 1000)}s`}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-linear"
          style={{
            width: `${ratio * 100}%`,
            background: urgent ? "var(--color-danger, #e74c3c)" : color,
          }}
        />
      </div>

      {/* 题干 */}
      <h2 className="text-lg font-semibold leading-relaxed">{question.stem}</h2>

      {/* 选项 */}
      <div className="space-y-2">
        {question.options.map((opt) => {
          const state = optionState(opt);
          const isPicked = pickedList.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              className="option-btn"
              data-state={state}
              disabled={submitted}
              onClick={() => onPick(opt)}
            >
              <span className="flex items-center gap-2.5">
                {question.type === "multi" && (
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                      isPicked ? "border-accent bg-accent text-white" : "border-border"
                    }`}
                    aria-hidden
                  >
                    {isPicked ? "✓" : ""}
                  </span>
                )}
                <span className="flex-1">{opt}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 多选题需要二次确认 */}
      {question.type === "multi" && !submitted && (
        <Button block onClick={onConfirm} disabled={pickedList.length === 0}>
          确认作答（已选 {pickedList.length} 项）
        </Button>
      )}

      {/* 解析 */}
      {submitted && (
        <div className="panel animate-fade-in space-y-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {pickedList.some((p) => answerList.includes(p)) ? (
              <span className="text-success">✓ 答对了</span>
            ) : (
              <span className="text-danger">✗ 答错了</span>
            )}
            <span className="text-muted">正确答案：{answerList.join("、")}</span>
          </div>
          <p className="text-sm leading-relaxed text-[#c9ced6]">{question.explanation}</p>
        </div>
      )}
    </div>
  );
}

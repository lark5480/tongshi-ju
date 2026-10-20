"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, RotateCcw, Users } from "lucide-react";

import { usePkChallenge } from "@/hooks/usePkChallenge";
import { QuestionCard } from "@/components/quiz/QuestionCard";
import { KnowledgeChain, type ChainSlot } from "@/components/quiz/KnowledgeChain";
import { ShareCard } from "@/components/result/ShareCard";
import { Button } from "@/components/ui/Button";
import { DOMAINS } from "@/content/domains";
import { getProfile } from "@/lib/storage";
import { isValidPkCode, normalizePkCode } from "@/lib/engine/pk";

const LIMIT_MS: Record<1 | 2 | 3, number> = { 1: 30_000, 2: 25_000, 3: 20_000 };

/**
 * 同题 PK —— 「同一个码，同一份题」。
 *
 * 没有服务器撮合，没有实时同步：两个人输入同一个 PK 码，
 * 各自本地跑同一份纯函数，拿到**完全相同**的 5 道题，
 * 各自作答、最后用成绩卡对账。
 */
export default function PkPage() {
  const pk = usePkChallenge();
  const [name, setName] = useState("通识玩家");
  const [emoji, setEmoji] = useState("🧠");

  useEffect(() => {
    const p = getProfile();
    setName(p.name);
    setEmoji(p.emoji);
  }, []);

  // ---- 大厅：选码 / 输入码 ----
  if (!pk.spec) {
    const codeValid = isValidPkCode(pk.code);
    return (
      <div className="space-y-5">
        <header className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm text-dim">
            <Users size={14} className="text-info" aria-hidden />
            同题 PK
          </p>
          <h1 className="text-2xl font-bold tracking-tight">同一个码，同一份题</h1>
          <p className="text-sm text-muted">
            两人输入同一个 PK 码，各自作答 —— 题目、顺序、难度完全相同。
            没有服务器撮合，题目由你本地的纯函数算出来。
          </p>
        </header>

        <div className="panel space-y-4 p-5">
          <div className="space-y-2">
            <label htmlFor="pk-code" className="text-sm font-medium">
              PK 码
            </label>
            <input
              id="pk-code"
              value={pk.code}
              onChange={(e) => pk.setCode(e.target.value)}
              placeholder="4–6 位字母或数字"
              inputMode="text"
              autoComplete="off"
              maxLength={12}
              aria-describedby="pk-code-hint"
              className="tabular w-full rounded-md border border-border bg-surface-2 px-4 py-3 text-lg font-semibold uppercase tracking-[0.2em] text-fg
                transition-colors duration-fast placeholder:tracking-normal placeholder:font-normal placeholder:text-dim
                focus:border-accent focus:outline-none"
            />
            <p id="pk-code-hint" className="text-xs text-dim">
              {codeValid
                ? "码有效 —— 对方输入同一个码，就会拿到你这份题。"
                : "码需要 4–6 位字母或数字（不含容易混淆的 I / O / 0 / 1）。"}
            </p>
          </div>

          <Button block size="lg" onClick={pk.start} disabled={pk.loading || !codeValid}>
            {pk.loading ? "正在抽题…" : "开始同题 PK"}
          </Button>

          <div className="rounded-md border border-border bg-surface-2 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted">今日推荐码</div>
                <div className="tabular mt-0.5 text-lg font-bold tracking-[0.15em] text-info">
                  {pk.suggested}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => pk.setCode(pk.suggested)}
                disabled={pk.code === pk.suggested}
              >
                使用
              </Button>
            </div>
            <p className="mt-2 text-xs text-dim">
              今天所有人用推荐码，看到的都是同一份题。
            </p>
          </div>

          {pk.error && (
            <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {pk.error}
            </p>
          )}
        </div>

        <div className="panel space-y-2 p-4 text-sm text-muted">
          <p className="font-semibold text-fg">怎么玩</p>
          <ol className="list-inside list-decimal space-y-1 text-xs leading-relaxed">
            <li>把 PK 码（或今日推荐码）发给朋友</li>
            <li>两人各自打开这个页面，输入同一个码</li>
            <li>各自答完 5 题，然后互相看成绩卡对账</li>
          </ol>
        </div>
      </div>
    );
  }

  // ---- 结算 ----
  if (pk.finished) {
    const correctCount = pk.records.filter((r) => r.correct).length;
    return (
      <div className="space-y-4">
        <div className="panel space-y-4 p-6 text-center">
          <div className="text-xs uppercase tracking-wide text-dim">PK {pk.spec?.code}</div>
          <div className="tabular text-4xl font-bold text-accent">{pk.score}</div>
          <div className="text-sm text-muted">
            答对 {correctCount} / {pk.questions.length} 题 · 最高连击 {pk.maxCombo}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {(pk.spec?.domains ?? []).map((d) => {
              const meta = DOMAINS.find((x) => x.id === d);
              return (
                <span
                  key={d}
                  className="rounded-pill px-2.5 py-1 text-xs"
                  style={{ background: `${meta?.color ?? "#8b93a1"}22`, color: meta?.color }}
                >
                  {meta?.emoji} {meta?.name}
                </span>
              );
            })}
          </div>
        </div>

        <div className="panel space-y-3 p-4">
          <h2 className="font-semibold">把成绩卡发给对方</h2>
          <p className="text-xs text-muted">
            卡上带着 PK 码和 5 格题目结果 —— 逐格就能比出谁在哪个领域更强。
          </p>
          <ShareCard
            date={pk.spec?.dateKey ?? ""}
            name={name}
            emoji={emoji}
            domains={pk.spec?.domains ?? []}
            score={pk.score}
            correct={correctCount}
            total={pk.questions.length}
            stars={Math.max(1, Math.min(3, correctCount))}
            maxCombo={pk.maxCombo}
            streak={0}
            pkCode={pk.spec?.code}
            label="同题 PK"
            cells={pk.records.map((r) => ({ domain: r.domain, correct: r.correct }))}
          />
        </div>

        <div className="flex gap-2">
          <Button block variant="secondary" onClick={pk.reset}>
            <RotateCcw size={15} aria-hidden />
            换个码再来
          </Button>
          <Link href="/duel" className="flex-1">
            <Button block variant="ghost">
              实时对战
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // ---- 答题 ----
  const q = pk.questions[pk.index];
  if (!q) return null;

  const chainSlots: ChainSlot[] = pk.questions.map((item, i) => {
    const rec = pk.records[i];
    return { domain: item.domain, answered: Boolean(rec), correct: Boolean(rec?.correct) };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">
          PK <span className="tabular font-semibold text-info">{pk.spec?.code}</span>
          <span className="ml-2 text-dim">
            第 {pk.index + 1} / {pk.questions.length} 题
          </span>
        </span>
        <span className="tabular font-semibold text-accent">{pk.score} 分</span>
      </div>

      <KnowledgeChain slots={chainSlots} combo={pk.combo} />

      <QuestionCard
        question={q}
        picked={pk.picked}
        submitted={pk.submitted}
        remaining={pk.remaining}
        limit={LIMIT_MS[q.difficulty]}
        onPick={pk.toggleOption}
        onConfirm={pk.submit}
      />

      {pk.submitted && (
        <Button block size="lg" onClick={pk.next}>
          {pk.index + 1 < pk.questions.length ? "下一题" : "查看结算"}
          <ArrowRight size={16} aria-hidden />
        </Button>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Check,
  CircleDot,
  Copy,
  Flame,
  Medal,
  RefreshCw,
  Share2,
  Target,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

import { useRoomStream } from "@/hooks/useRoomStream";
import { useCountdown } from "@/hooks/useCountdown";
import { Button } from "@/components/ui/Button";
import { domainColor, domainName } from "@/content/domains";
import { domainIcon } from "@/components/domain/DomainCard";
import { dayKey } from "@/lib/engine/date";
import { buildDuelSettlement } from "@/lib/engine/duel-settlement";
import {
  getDuelSettledMatch,
  getRoomPlayerId,
  pushHistory,
  recordAttempt,
  setDuelSettledMatch,
} from "@/lib/storage";
import type { PublicPlayer, RoomSnapshot, Slot } from "@/types";

/**
 * 复制到剪贴板 —— 优先用异步剪贴板 API，
 * 在非安全上下文（http 局域网调试）里降级到 execCommand。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到降级方案 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 对战房间：大厅准备 → 倒计时 → 抢答 → 结算 → 结束。 */
export default function DuelRoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toUpperCase();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [mySlot, setMySlot] = useState<Slot | null>(null);
  const [picked, setPicked] = useState<string | string[]>("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const { snapshot, lastEvent, connecting, reconnecting, serverOffset } = useRoomStream(
    code,
    playerId
  );

  // ---- 读取本地凭证 + 确认自己的席位 ----
  useEffect(() => {
    if (!code) return;
    const pid = getRoomPlayerId(code);
    if (!pid) {
      setError("没有找到本房间的凭证，请回到大厅重新加入。");
      return;
    }
    setPlayerId(pid);

    void (async () => {
      try {
        const res = await fetch(`/api/rooms/${code}?playerId=${encodeURIComponent(pid)}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setError("房间不存在或已结束。");
          return;
        }
        const data = await res.json();
        if (data.you) setMySlot(data.you.slot);
      } catch {
        /* 等待 SSE 补齐 */
      }
    })();
  }, [code]);

  const status = snapshot?.status ?? "lobby";
  const roundIndex = snapshot?.roundIndex ?? 0;
  const totalRounds = snapshot?.totalRounds ?? 5;
  /**
   * 结算后服务端把 `roundIndex` 推到 5（= 题数），直接 +1 会显示「第 6 / 5 题」。
   * 展示一律钳到总题数。
   */
  const shownRound = Math.min(roundIndex + 1, totalRounds);
  const currentQuestion = snapshot?.questions?.[roundIndex] ?? null;

  // 倒计时：答题阶段看 deadlineAt，倒计时阶段看 nextAt
  const deadline =
    status === "question"
      ? (snapshot?.deadlineAt ?? null)
      : status === "countdown"
        ? (snapshot?.nextAt ?? null)
        : null;
  const { seconds, remaining } = useCountdown(deadline, serverOffset);

  // ---- 事件驱动的瞬时反馈 ----
  const [opponentAnswered, setOpponentAnswered] = useState(false);
  useEffect(() => {
    if (!lastEvent || mySlot === null) return;
    if (lastEvent.type === "player_answered") {
      setOpponentAnswered(lastEvent.playerSlot !== mySlot);
    }
    if (lastEvent.type === "round_start" || lastEvent.type === "round_result") {
      setOpponentAnswered(false);
      setSubmitted(false);
      setPicked("");
    }
  }, [lastEvent, mySlot]);

  /**
   * 回合号一变就清本地提交态 —— **不能只靠事件**。
   * SSE 轮换 / 重连的间隙里会漏掉 `round_start`，而快照里的 `roundIndex` 是权威的：
   * 漏事件的后果是选项永远停在「已提交」的禁用态，玩家从第 2 题起再也答不了。
   */
  const seenRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (seenRoundRef.current === roundIndex) return;
    seenRoundRef.current = roundIndex;
    setSubmitted(false);
    setPicked("");
    setOpponentAnswered(false);
  }, [roundIndex]);

  const me = useMemo(
    () => snapshot?.players.find((p) => p.slot === mySlot) ?? null,
    [snapshot, mySlot]
  );
  const opponent = useMemo(
    () => snapshot?.players.find((p) => p.slot !== mySlot) ?? null,
    [snapshot, mySlot]
  );
  const isHost = mySlot !== null && snapshot?.hostSlot === mySlot;

  // ---- 结算落本地档案（history / 熟练度 / 错题本） ----
  // duel 不写 streak、lifetime/段位、影子、每日 session（见 docs/GAME-RULES.md §11.3）。
  // 用 ref 记住已处理的 matchId：同一次渲染 / SSE 重复快照不会重复写；
  // 刷新页面时本地已记录 matchId，同样跳过。rematch 换了 matchId 才重新结算。
  const settledMatchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot || snapshot.status !== "finished" || mySlot === null) return;
    if (settledMatchRef.current === snapshot.matchId) return;
    const plan = buildDuelSettlement(snapshot, mySlot, dayKey());
    if (!plan) return;
    settledMatchRef.current = plan.matchId;
    if (getDuelSettledMatch(code) === plan.matchId) return;
    for (const attempt of plan.attempts) recordAttempt(attempt);
    pushHistory(plan.history);
    setDuelSettledMatch(code, plan.matchId);
  }, [snapshot, mySlot, code]);

  // ---- 动作 ----
  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      if (!playerId) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${code}/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId, ...body }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "操作失败");
        return data;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [code, playerId]
  );

  const toggleReady = () => post("ready", { ready: !me?.ready });
  const start = () => post("start", {});
  const rematch = () => post("rematch", {});

  const pick = (option: string) => {
    if (submitted || !currentQuestion) return;
    if (currentQuestion.type === "multi") {
      setPicked((prev) => {
        const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
        return list.includes(option) ? list.filter((o) => o !== option) : [...list, option];
      });
      return;
    }
    setPicked(option);
    // 答案跟着调用走，不依赖 setPicked 的重渲染时序（见 docs/TESTING.md §5.2）
    submitAnswer(option);
  };

  const submitAnswer = async (answer: string | string[]) => {
    if (submitted) return;
    setSubmitted(true);
    const res = await post("answer", { roundIndex, answer });
    if (!res) {
      // 提交失败：允许重试（服务端幂等，不会重复计分）
      setSubmitted(false);
    }
  };

  // ---- 渲染 ----
  if (error && !snapshot) {
    return (
      <div className="panel space-y-3 p-6 text-center">
        <p className="text-muted">{error}</p>
        <Button variant="secondary" onClick={() => (window.location.href = "/duel")}>
          返回大厅
        </Button>
      </div>
    );
  }

  if (connecting && !snapshot) {
    return (
      <div
        className="flex h-64 flex-col items-center justify-center gap-2 text-muted"
        aria-busy="true"
      >
        <RefreshCw size={20} className="animate-pulse-soft" aria-hidden />
        <span>正在连接房间</span>
      </div>
    );
  }

  if (!snapshot) return null;

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/duel/room/${code}` : "";

  // 比分取快照里的 scores / combos（按 slot 索引）。
  // 不用 players[].score：服务端只写 room.scores，players[].score 恒为 0。
  const myScore = me ? (snapshot.scores[String(mySlot ?? 0)] ?? 0) : 0;
  const oppScore = opponent ? (snapshot.scores[String(opponent.slot)] ?? 0) : 0;
  const myCombo = me ? (snapshot.combos[String(mySlot ?? 0)] ?? 0) : 0;
  const oppCombo = opponent ? (snapshot.combos[String(opponent.slot)] ?? 0) : 0;

  const scoreTotal = myScore + oppScore;
  const myPct = scoreTotal > 0 ? myScore / scoreTotal : 0.5;
  const oppPct = scoreTotal > 0 ? oppScore / scoreTotal : 0.5;

  // 最后 5 秒告急
  const urgent = status === "question" && seconds <= 5;
  const limit = Math.max(1, snapshot.limitMs);
  const timeRatio = Math.max(0, Math.min(1, remaining / limit));

  const QuestionIcon = currentQuestion ? domainIcon(currentQuestion.domain) : null;

  const doCopy = async (text: string) => {
    const ok = await copyText(text);
    if (!ok) {
      setError("复制失败，手动选中即可复制");
      return;
    }
    setError(null);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* 顶部状态条：房间码 + 连接状态 + 倒计时 */}
      <div className="panel flex items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">房间码</div>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="tabular text-2xl font-bold tracking-[0.2em] text-accent">{code}</div>
            <button
              type="button"
              onClick={() => void doCopy(code)}
              aria-label={copied ? "房间码已复制" : "复制房间码"}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-muted transition-colors duration-fast hover:border-border-strong hover:text-fg"
            >
              {copied ? (
                <Check size={17} className="text-success" aria-hidden />
              ) : (
                <Copy size={17} aria-hidden />
              )}
            </button>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5 text-xs">
            {reconnecting ? (
              <span className="flex items-center gap-1.5 text-gold">
                <RefreshCw size={13} className="animate-pulse-soft" aria-hidden />
                重连中
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted">
                <CircleDot size={13} className="text-success" aria-hidden />
                已连接
              </span>
            )}
          </div>
          {status === "question" && (
            <div
              className={`tabular mt-1 text-2xl font-bold ${
                urgent ? "animate-pulse-soft text-danger" : "text-fg"
              }`}
            >
              {seconds}s
            </div>
          )}
          {status === "countdown" && (
            <div className="tabular mt-1 text-2xl font-bold text-accent">准备 {seconds}s</div>
          )}
        </div>
      </div>

      {/* 答题阶段：剩余时间条 */}
      {status === "question" && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2"
          role="img"
          aria-label={`剩余 ${seconds} 秒`}
        >
          <div
            className={`h-full w-full origin-left rounded-pill transition-all duration-base ${
              urgent ? "bg-danger" : "bg-accent"
            }`}
            style={{ transform: `scaleX(${timeRatio})` }}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {/* 双方比分条 */}
      <div className="panel space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <PlayerSide player={me} mine score={myScore} combo={myCombo} />
          <div className="shrink-0 pt-1 text-center">
            <div className="tabular text-[11px] text-muted">
              第 {shownRound} / {totalRounds} 题
            </div>
            <div className="mt-1 text-[11px] text-dim">比分</div>
          </div>
          <PlayerSide player={opponent} score={oppScore} combo={oppCombo} />
        </div>

        <div
          className="relative h-2.5 overflow-hidden rounded-pill bg-surface-2"
          role="img"
          aria-label={`比分 ${myScore} 比 ${oppScore}`}
        >
          <div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-pill bg-gradient-to-r from-accent to-accent-soft transition-transform duration-base"
            style={{ transform: `scaleX(${myPct})` }}
          />
          <div
            className="absolute inset-y-0 right-0 w-full origin-right rounded-pill bg-info/70 transition-transform duration-base"
            style={{ transform: `scaleX(${oppPct})` }}
          />
        </div>
      </div>

      {/* 领域 */}
      {snapshot.domains.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {snapshot.domains.map((d) => {
            const Icon = domainIcon(d);
            return (
              <span
                key={d}
                className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs"
                style={{
                  background: `${domainColor(d)}22`,
                  color: domainColor(d),
                }}
              >
                <Icon size={13} strokeWidth={2.1} aria-hidden />
                {domainName(d)}
              </span>
            );
          })}
        </div>
      )}

      {/* ===== 大厅 ===== */}
      {status === "lobby" && (
        <div className="panel space-y-3 p-4">
          <h2 className="font-semibold">等待对手</h2>
          <div className="rounded-md bg-surface-2 p-3">
            <p className="text-xs text-muted">把房间码或链接发给朋友</p>
            <p className="tabular mt-1 select-all text-2xl font-bold tracking-[0.2em] text-accent">
              {code}
            </p>
            <Button
              className="mt-2"
              variant="secondary"
              onClick={() => void doCopy(shareUrl)}
              disabled={!shareUrl}
            >
              <Share2 size={16} aria-hidden />
              复制邀请链接
            </Button>
          </div>

          <div className="flex gap-2">
            <Button block onClick={toggleReady} disabled={busy || !opponent}>
              {me?.ready ? "取消准备" : "我准备好了"}
            </Button>
            {isHost && (
              <Button
                block
                variant="secondary"
                onClick={start}
                disabled={busy || !opponent || !me?.ready || !opponent?.ready}
              >
                开始对局
              </Button>
            )}
          </div>
          {!opponent && (
            <p className="text-center text-xs text-muted">房间码已生成，等待好友加入</p>
          )}
        </div>
      )}

      {/* ===== 倒计时 ===== */}
      {status === "countdown" && (
        <div className="panel flex flex-col items-center space-y-2 p-8">
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Target size={15} aria-hidden />第 {roundIndex + 1} 题即将开始
          </p>
          <div className="tabular text-6xl font-bold text-accent">{seconds}</div>
        </div>
      )}

      {/* ===== 答题 ===== */}
      {status === "question" && currentQuestion && (
        <div className="space-y-4">
          {opponentAnswered && !submitted && (
            <div className="flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold">
              <Zap size={15} aria-hidden />
              对方已经作答
            </div>
          )}

          <div className="panel space-y-4 p-4">
            <div className="flex items-center justify-between">
              <span
                className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs"
                style={{
                  background: `${domainColor(currentQuestion.domain)}22`,
                  color: domainColor(currentQuestion.domain),
                }}
              >
                {QuestionIcon && <QuestionIcon size={13} strokeWidth={2.1} aria-hidden />}
                {domainName(currentQuestion.domain)}
              </span>
              <span
                className={`tabular text-sm font-semibold ${urgent ? "text-danger" : "text-muted"}`}
              >
                {seconds}s
              </span>
            </div>

            <h2 className="text-lg font-semibold leading-relaxed">{currentQuestion.stem}</h2>

            <div className="space-y-2">
              {currentQuestion.options.map((opt) => {
                const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
                const isPicked = list.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    className="option-btn"
                    disabled={submitted}
                    onClick={() => pick(opt)}
                  >
                    <span className="flex items-center gap-2.5">
                      {currentQuestion.type === "multi" && (
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border ${
                            isPicked ? "border-accent bg-accent text-white" : "border-border"
                          }`}
                          aria-hidden
                        >
                          {isPicked && <Check size={13} strokeWidth={3} />}
                        </span>
                      )}
                      <span className="flex-1">{opt}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {currentQuestion.type === "multi" && !submitted && (
              <Button
                block
                onClick={() => submitAnswer(picked)}
                disabled={(Array.isArray(picked) ? picked.length : 0) === 0 || busy}
              >
                确认作答
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ===== 回合结算 ===== */}
      {status === "feedback" && (
        <div className="space-y-3">
          {snapshot.history.length > 0 &&
            (() => {
              const rec = snapshot.history[snapshot.history.length - 1];
              const won = rec.winnerSlot === mySlot;
              const drew = rec.winnerSlot === null;
              return (
                <div className="panel space-y-3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`flex items-center gap-2 text-lg font-bold ${
                        won ? "text-success" : drew ? "text-muted" : "text-danger"
                      }`}
                    >
                      {won ? (
                        <Trophy size={20} aria-hidden />
                      ) : drew ? (
                        <Timer size={20} aria-hidden />
                      ) : (
                        <Zap size={20} aria-hidden />
                      )}
                      {won ? "这回合你赢了" : drew ? "都没答对" : "被对方抢先了"}
                    </span>
                    <span className="tabular shrink-0 text-sm text-muted">
                      {rec.elapsed[String(mySlot ?? 0)] !== null &&
                      rec.elapsed[String(mySlot ?? 0)] !== undefined
                        ? `${(rec.elapsed[String(mySlot ?? 0)] ?? 0) / 1000}s`
                        : "未作答"}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    正确答案：
                    {Array.isArray(rec.correctAnswer)
                      ? rec.correctAnswer.join("、")
                      : rec.correctAnswer}
                  </p>
                  <p className="text-[15px] leading-[1.65] text-fg/80">{rec.explanation}</p>
                </div>
              );
            })()}
          <p className="text-center text-xs text-muted">下一题即将开始</p>
        </div>
      )}

      {/* ===== 结束 ===== */}
      {status === "finished" && (
        <div className="panel space-y-4 p-6 text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted">
            <Medal size={15} className="text-gold" aria-hidden />
            对局结束
          </p>
          <div className="space-y-2">
            {snapshot.players.map((p) => (
              <div
                key={p.slot}
                className={`flex items-center gap-3 rounded-md p-3 text-left ${
                  p.slot === mySlot ? "bg-accent/10" : "bg-surface-2"
                }`}
              >
                <span className="text-2xl" aria-hidden>
                  {p.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {p.name}
                    {p.slot === mySlot ? "（你）" : ""}
                  </div>
                  <div className="text-xs text-muted">抢先答对 {p.firstCorrect} 题</div>
                </div>
                <span className="tabular text-xl font-bold text-accent">
                  {snapshot.scores[String(p.slot)] ?? 0}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted">战绩已记入本地档案（不计连续天数与段位）</p>
          {isHost && (
            <Button block onClick={rematch} disabled={busy}>
              再来一局
            </Button>
          )}
          {!isHost && <p className="text-xs text-muted">等待房主发起再来一局</p>}
        </div>
      )}
    </div>
  );
}

/** 比分条的一侧：头像、名字、在线/准备状态、分数与连击。 */
function PlayerSide({
  player,
  mine,
  score,
  combo,
}: {
  player: PublicPlayer | null;
  mine?: boolean;
  score: number;
  combo: number;
}) {
  const align = mine ? "items-start text-left" : "items-end text-right";
  const row = mine ? "justify-start" : "justify-end";

  return (
    <div className={`min-w-0 flex-1 ${align}`}>
      <div className={`flex items-center gap-1.5 ${row}`}>
        {player ? (
          <span className="text-xl" aria-hidden>
            {player.emoji}
          </span>
        ) : (
          <Users size={18} className="shrink-0 text-dim" aria-hidden />
        )}
        <span className="truncate text-sm font-semibold">{player?.name ?? "等待加入"}</span>
        {mine && (
          <span className="shrink-0 rounded-pill bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
            你
          </span>
        )}
      </div>

      <div className={`mt-0.5 flex items-center gap-1.5 text-xs ${row}`}>
        {player ? (
          <>
            <span className={player.connected ? "text-success" : "text-danger"}>
              {player.connected ? "在线" : "掉线"}
            </span>
            <span className="text-dim">·</span>
            <span className={player.ready ? "text-success" : "text-muted"}>
              {player.ready ? "已准备" : "未准备"}
            </span>
          </>
        ) : (
          <span className="text-dim">—</span>
        )}
      </div>

      <div className={`tabular mt-1 text-2xl font-bold ${mine ? "text-accent" : "text-info"}`}>
        {score}
        <span className="ml-0.5 text-xs font-normal text-dim">分</span>
      </div>

      {combo >= 2 && (
        <div className={`mt-0.5 flex items-center gap-1 text-xs text-gold ${row}`}>
          <Flame size={12} aria-hidden />
          <span className="tabular">{combo} 连击</span>
        </div>
      )}
    </div>
  );
}

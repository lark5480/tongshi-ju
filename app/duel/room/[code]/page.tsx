"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { useRoomStream } from "@/hooks/useRoomStream";
import { useCountdown } from "@/hooks/useCountdown";
import { Button } from "@/components/ui/Button";
import { DOMAINS, domainColor, domainEmoji, domainName } from "@/content/domains";
import { getRoomPlayerId } from "@/lib/storage";
import type { RoomSnapshot, Slot } from "@/types";

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

  const me = useMemo(
    () => snapshot?.players.find((p) => p.slot === mySlot) ?? null,
    [snapshot, mySlot]
  );
  const opponent = useMemo(
    () => snapshot?.players.find((p) => p.slot !== mySlot) ?? null,
    [snapshot, mySlot]
  );
  const isHost = mySlot !== null && snapshot?.hostSlot === mySlot;

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
    void setTimeout(() => submitAnswer(option), 0);
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
      <div className="flex h-64 items-center justify-center text-muted">
        <span className="animate-pulse">正在连接房间…</span>
      </div>
    );
  }

  if (!snapshot) return null;

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/duel/room/${code}` : "";

  return (
    <div className="space-y-4">
      {/* 顶部状态条 */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted">房间码</div>
          <div className="tabular text-2xl font-bold tracking-[0.2em] text-accent">{code}</div>
        </div>
        <div className="text-right text-xs">
          {reconnecting ? (
            <span className="text-warn">🔄 重连中…</span>
          ) : (
            <span className="text-muted">● 已连接</span>
          )}
          {status === "question" && (
            <div className="tabular mt-1 text-lg font-bold">{seconds}s</div>
          )}
          {status === "countdown" && (
            <div className="tabular mt-1 text-lg font-bold text-warn">准备 {seconds}s</div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* 玩家 */}
      <div className="grid grid-cols-2 gap-3">
        {[me, opponent].map((p, i) => (
          <div key={i} className={`panel p-3 ${p ? "" : "opacity-50"}`}>
            <div className="flex items-center gap-2">
              <span className="text-xl">{p?.emoji ?? "❔"}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {p?.name ?? "等待加入…"}
                  {i === 0 && mySlot === 0 ? "（你）" : ""}
                </div>
                <div className="text-xs text-muted">
                  {p ? (p.connected ? "在线" : "掉线") : "—"}
                </div>
              </div>
            </div>
            <div className="tabular mt-2 flex items-center justify-between text-xs">
              <span className="text-muted">{p?.ready ? "✅ 已准备" : "⏳ 未准备"}</span>
              <span className="font-semibold text-accent">{p?.score ?? 0} 分</span>
            </div>
            {(p?.combo ?? 0) >= 2 && (
              <div className="mt-1 text-right text-xs text-warn">🔥 {p?.combo} 连击</div>
            )}
          </div>
        ))}
      </div>

      {/* 领域 */}
      {snapshot.domains.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {snapshot.domains.map((d) => (
            <span
              key={d}
              className="rounded-full px-2.5 py-1 text-xs"
              style={{
                background: `${domainColor(d)}22`,
                color: domainColor(d),
              }}
            >
              {domainEmoji(d)} {domainName(d)}
            </span>
          ))}
        </div>
      )}

      {/* ===== 大厅 ===== */}
      {status === "lobby" && (
        <div className="panel space-y-3 p-4">
          <h2 className="font-semibold">等待对手</h2>
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="text-xs text-muted">把房间码或链接发给朋友</p>
            <p className="tabular mt-1 select-all text-lg font-bold tracking-[0.2em] text-accent">
              {code}
            </p>
            <Button
              className="mt-2"
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(shareUrl);
              }}
            >
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
            <p className="text-center text-xs text-muted">房间码已生成，等待好友加入…</p>
          )}
        </div>
      )}

      {/* ===== 倒计时 ===== */}
      {status === "countdown" && (
        <div className="panel flex flex-col items-center space-y-2 p-8">
          <p className="text-sm text-muted">第 {roundIndex + 1} 题即将开始</p>
          <div className="tabular text-6xl font-bold text-accent">{seconds}</div>
        </div>
      )}

      {/* ===== 答题 ===== */}
      {status === "question" && currentQuestion && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">
              第 {roundIndex + 1} / {totalRounds} 题
            </span>
            <span className="tabular font-semibold text-accent">{me?.score ?? 0} 分</span>
          </div>

          {opponentAnswered && !submitted && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              ⚡ 对方已经作答了！
            </div>
          )}

          <div className="panel space-y-4 p-4">
            <div className="flex items-center justify-between">
              <span
                className="rounded-full px-2.5 py-1 text-xs"
                style={{
                  background: `${domainColor(currentQuestion.domain)}22`,
                  color: domainColor(currentQuestion.domain),
                }}
              >
                {domainEmoji(currentQuestion.domain)} {domainName(currentQuestion.domain)}
              </span>
              <span className="tabular text-sm text-muted">{seconds}s</span>
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
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-lg font-bold ${won ? "text-success" : drew ? "text-muted" : "text-danger"}`}
                    >
                      {won ? "🎉 这回合你赢了！" : drew ? "⏱ 都没答对" : "⚡ 被对方抢先了"}
                    </span>
                    <span className="tabular text-sm text-muted">
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
                  <p className="text-sm leading-relaxed text-[#c9ced6]">{rec.explanation}</p>
                </div>
              );
            })()}
          <p className="text-center text-xs text-muted">下一题即将开始…</p>
        </div>
      )}

      {/* ===== 结束 ===== */}
      {status === "finished" && (
        <div className="panel space-y-4 p-6 text-center">
          <p className="text-sm text-muted">对局结束</p>
          <div className="space-y-2">
            {snapshot.players.map((p) => (
              <div
                key={p.slot}
                className={`flex items-center gap-3 rounded-lg p-3 ${
                  p.slot === mySlot ? "bg-accent/10" : "bg-surface-2"
                }`}
              >
                <span className="text-2xl">{p.emoji}</span>
                <div className="flex-1 text-left">
                  <div className="font-medium">
                    {p.name}
                    {p.slot === mySlot ? "（你）" : ""}
                  </div>
                  <div className="text-xs text-muted">抢先答对 {p.firstCorrect} 题</div>
                </div>
                <span className="tabular text-xl font-bold text-accent">{p.score}</span>
              </div>
            ))}
          </div>
          {isHost && (
            <Button block onClick={rematch} disabled={busy}>
              再来一局
            </Button>
          )}
          {!isHost && <p className="text-xs text-muted">等待房主发起再来一局…</p>}
        </div>
      )}
    </div>
  );
}

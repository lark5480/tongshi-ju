"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { getProfile, setRoomPlayerId } from "@/lib/storage";
import { DOMAINS } from "@/content/domains";

/** 对战大厅：创建房间 / 输入房间码加入。 */
export default function DuelLobbyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🧠");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const EMOJIS = ["🧠", "🔥", "🐯", "🦊", "🐼", "🦁", "🐧", "🦉", "🚀", "⚡"];

  useEffect(() => {
    const p = getProfile();
    setName(p.name);
    setEmoji(p.emoji);
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = getProfile();
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, emoji, domains: profile.domains }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "创建房间失败");
      setRoomPlayerId(data.code, data.playerId);
      router.push(`/duel/room/${data.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase(), name, emoji }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加入房间失败");
      setRoomPlayerId(data.code, data.playerId);
      router.push(`/duel/room/${data.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const domains = getProfile().domains;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">⚔️ 同步抢答</h1>
        <p className="mt-1 text-sm text-muted">
          同一题面同时开始，先答对者赢下这一回合。答错即锁定 0 分 —— 敢不敢早按？
        </p>
      </header>

      {/* 身份 */}
      <div className="panel space-y-3 p-4">
        <div>
          <label className="text-xs text-muted" htmlFor="duel-name">
            昵称
          </label>
          <input
            id="duel-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 12))}
            placeholder="给自己起个名字"
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <span className="text-xs text-muted">头像</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
                  emoji === e
                    ? "border-accent bg-accent/15"
                    : "border-border bg-surface-2 hover:border-accent/50"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        {domains.length > 0 && (
          <p className="text-xs text-muted">
            本局领域取你的本命：
            {domains.map((d) => DOMAINS.find((x) => x.id === d)?.name).join(" · ")}
          </p>
        )}
        {domains.length === 0 && (
          <p className="text-xs text-warn">你还没选领域，本局将随机分配三个领域。</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      {/* 创建 */}
      <div className="panel space-y-3 p-4">
        <h2 className="font-semibold">创建房间</h2>
        <p className="text-xs text-muted">创建后会得到一个 6 位房间码，把它发给朋友即可开始。</p>
        <Button block size="lg" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "处理中…" : "创建房间"}
        </Button>
      </div>

      {/* 加入 */}
      <div className="panel space-y-3 p-4">
        <h2 className="font-semibold">加入房间</h2>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="输入 6 位房间码"
          inputMode="text"
          autoCapitalize="characters"
          className="tabular w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] outline-none focus:border-accent"
        />
        <Button
          block
          variant="secondary"
          onClick={join}
          disabled={busy || code.length < 4 || !name.trim()}
        >
          加入房间
        </Button>
      </div>

      <p className="text-center text-xs text-muted">
        联机对战需要在**本地**运行服务（双击 <code>play-online.bat</code>），
        公网部署下房间状态可能因多实例而不一致。
      </p>
    </div>
  );
}

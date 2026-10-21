"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Rocket, Share2, Swords, Users } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { getProfile, setRoomPlayerId } from "@/lib/storage";
import { DOMAINS } from "@/content/domains";

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

/** 对战大厅：创建房间 / 输入房间码加入。 */
export default function DuelLobbyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🧠");
  const [code, setCode] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const EMOJIS = ["🧠", "🔥", "🐯", "🦊", "🐼", "🦁", "🐧", "🦉", "🚀", "⚡"];

  useEffect(() => {
    const p = getProfile();
    setName(p.name);
    setEmoji(p.emoji);
    setDomains(p.domains);
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

  const copyCode = async () => {
    const ok = await copyText(code.trim().toUpperCase());
    if (!ok) {
      setError("复制失败，手动选中房间码复制即可");
      return;
    }
    setCopied(true);
    setError(null);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Swords size={20} className="text-accent" aria-hidden />
          同步抢答
        </h1>
        <p className="text-sm text-muted">
          同一题面同时开始，先答对者独占该题分值。答错记 0 分，但回合不结束 —— 敢不敢早按？
        </p>
      </header>

      {/* 身份 */}
      <div className="panel space-y-4 p-4">
        <div>
          <label className="text-xs text-muted" htmlFor="duel-name">
            昵称
          </label>
          <input
            id="duel-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 12))}
            placeholder="给自己起个名字"
            className="mt-1 min-h-[44px] w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm outline-none transition-colors duration-fast focus:border-accent"
          />
        </div>

        <div>
          <span className="text-xs text-muted">头像</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-label={`头像 ${e}`}
                aria-pressed={emoji === e}
                className={`flex h-11 w-11 items-center justify-center rounded-md border text-xl transition-all duration-fast ${
                  emoji === e
                    ? "border-accent bg-accent/15"
                    : "border-border bg-surface-2 hover:border-accent/50"
                }`}
              >
                <span aria-hidden>{e}</span>
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
          <p className="flex items-center gap-1.5 text-xs text-gold">
            <Users size={13} aria-hidden />
            你还没选领域，本局将随机分配三个领域。
          </p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </div>
      )}

      {/* 创建 */}
      <div className="panel space-y-3 p-4">
        <h2 className="font-semibold">创建房间</h2>
        <p className="text-xs text-muted">创建后会得到一个 6 位房间码，把它发给朋友即可开始。</p>
        <Button block size="lg" onClick={create} disabled={busy || !name.trim()}>
          <Rocket size={16} aria-hidden />
          {busy ? "处理中…" : "创建房间"}
        </Button>
      </div>

      {/* 加入 */}
      <div className="panel space-y-3 p-4">
        <h2 className="font-semibold">加入房间</h2>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="6 位房间码"
            aria-label="房间码"
            inputMode="text"
            autoCapitalize="characters"
            className="tabular min-h-[48px] min-w-0 flex-1 rounded-sm border border-border bg-surface-2 px-3 text-center text-xl font-bold tracking-[0.3em] outline-none transition-colors duration-fast placeholder:tracking-[0.05em] focus:border-accent"
          />
          <Button
            variant="secondary"
            onClick={copyCode}
            disabled={code.length === 0}
            aria-label={copied ? "房间码已复制" : "复制房间码"}
            className="min-w-[48px]"
          >
            {copied ? <Check size={17} aria-hidden /> : <Copy size={17} aria-hidden />}
          </Button>
        </div>
        <p className="text-xs text-dim">房间码不区分大小写，6 位字母数字。</p>
        <Button
          block
          size="lg"
          variant="secondary"
          onClick={join}
          disabled={busy || code.length < 4 || !name.trim()}
        >
          <Share2 size={16} aria-hidden />
          加入房间
        </Button>
      </div>

      <p className="text-center text-xs leading-relaxed text-muted">
        联机对战需要在<strong className="text-fg">本地</strong>运行服务（双击{" "}
        <code className="rounded-sm bg-surface-2 px-1 py-0.5">play-online.bat</code>），
        公网部署下房间状态可能因多实例而不一致。
      </p>
    </div>
  );
}

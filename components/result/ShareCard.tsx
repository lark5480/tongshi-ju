"use client";

import { useCallback, useState } from "react";

import { DOMAINS } from "@/content/domains";
import { Button } from "@/components/ui/Button";

interface ShareCardProps {
  date: string;
  name: string;
  emoji: string;
  domains: string[];
  score: number;
  correct: number;
  total: number;
  stars: number;
  maxCombo: number;
  streak: number;
}

const W = 1200;
const H = 630;

/**
 * 成绩卡图 —— 用 Canvas 生成 1200×630 PNG。
 *
 * 不引第三方图表/图片库：绘制逻辑简单，Canvas 原生足够。
 * 分享链路：优先 `navigator.share`（移动端可分享文件），
 * 降级为「长按图片保存」或「下载 PNG」。
 */
export function ShareCard(props: ShareCardProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const render = useCallback((): string | null => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 背景
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#0f1115");
    bg.addColorStop(1, "#1c2029");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部强调条
    const accent = ctx.createLinearGradient(0, 0, W, 0);
    accent.addColorStop(0, "#FF5C1A");
    accent.addColorStop(1, "#FF7A45");
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 8);

    // 标题
    ctx.fillStyle = "#e8eaed";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.fillText(`${props.emoji} 通识局 · 今日挑战`, 72, 108);

    ctx.fillStyle = "#8b93a1";
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText(props.date, 72, 158);

    // 分数
    ctx.fillStyle = "#FF5C1A";
    ctx.font = "bold 150px system-ui, sans-serif";
    ctx.fillText(String(props.score), 68, 320);

    ctx.fillStyle = "#8b93a1";
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText("分", 72 + ctx.measureText(String(props.score)).width + 24, 320);

    // 星级
    ctx.font = "46px system-ui, sans-serif";
    ctx.fillText("⭐".repeat(Math.max(1, props.stars)), 72, 396);

    // 右侧信息
    const infoX = 620;
    ctx.fillStyle = "#e8eaed";
    ctx.font = "34px system-ui, sans-serif";
    ctx.fillText(`答对 ${props.correct} / ${props.total} 题`, infoX, 210);

    if (props.maxCombo >= 2) {
      ctx.fillStyle = "#f1c40f";
      ctx.font = "34px system-ui, sans-serif";
      ctx.fillText(`🔥 最高 ${props.maxCombo} 连击`, infoX, 262);
    }
    if (props.streak > 0) {
      ctx.fillStyle = "#f1c40f";
      ctx.font = "34px system-ui, sans-serif";
      ctx.fillText(`🔥 连续 ${props.streak} 天`, infoX, 314);
    }

    // 领域标签
    let x = infoX;
    const y = 396;
    ctx.font = "26px system-ui, sans-serif";
    for (const d of props.domains) {
      const meta = DOMAINS.find((m) => m.id === d);
      if (!meta) continue;
      const label = `${meta.emoji} ${meta.name}`;
      const w = ctx.measureText(label).width + 28;
      if (x + w > W - 72) break;
      ctx.fillStyle = `${meta.color}33`;
      roundRect(ctx, x, y - 32, w, 44, 22);
      ctx.fill();
      ctx.fillStyle = meta.color;
      ctx.fillText(label, x + 14, y);
      x += w + 12;
    }

    // 页脚
    ctx.fillStyle = "#5b6472";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText("每天三域，各显所长 · tongshi-ju", 72, H - 56);

    return canvas.toDataURL("image/png");
  }, [props]);

  const generate = useCallback(() => {
    setBusy(true);
    try {
      const url = render();
      setDataUrl(url);
    } finally {
      setBusy(false);
    }
  }, [render]);

  const share = useCallback(async () => {
    const url = dataUrl ?? render();
    if (!url) return;
    setDataUrl(url);

    // 移动端：优先系统分享（可分享文件）
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], "tongshi-ju.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "通识局今日挑战" });
        return;
      }
    } catch {
      // 用户取消或不支持 → 走下载
    }
    download(url);
  }, [dataUrl, render]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="secondary" block onClick={generate} disabled={busy}>
          {dataUrl ? "重新生成" : "生成成绩卡"}
        </Button>
        {dataUrl && (
          <Button block onClick={() => void share()}>
            分享 / 保存
          </Button>
        )}
      </div>

      {dataUrl && (
        <div className="panel overflow-hidden p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl} alt="今日挑战成绩卡" className="w-full rounded-lg" />
          <p className="mt-2 text-center text-xs text-muted">
            长按图片可保存到相册，或点「分享 / 保存」下载 PNG。
          </p>
        </div>
      )}
    </div>
  );
}

function download(dataUrl: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = "tongshi-ju.png";
  a.click();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

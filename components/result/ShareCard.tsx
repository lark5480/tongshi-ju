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
  /** PK 码（可选）。同题 PK 的成绩卡会带上它，方便双方核对。 */
  pkCode?: string;
  /** 逐题结果（可选）。渲染成「同题方块网格」—— 5 格 = 5 题。 */
  cells?: { domain: string; correct: boolean }[];
  /** 副标题（可选）。例如"同题 PK"。 */
  label?: string;
}

const W = 1200;
const H = 630;

/**
 * 成绩卡图 —— 用 Canvas 生成 1200×630 PNG。
 *
 * 不引第三方图表/图片库：绘制逻辑简单，Canvas 原生足够。
 * 分享链路：优先 `navigator.share`（移动端可分享文件），
 * 降级为「长按图片保存」或「下载 PNG」。
 *
 * ## 同题方块网格
 *
 * 借鉴 Wordle 的传播结构：**只给结果，不剧透**。
 * 5 个方块 = 5 道题，每格用该题所属**领域的主题色**填充（答对），
 * 答错则暗红。它是"同题 PK"的对账凭证 —— 两个人看彼此的卡片，
 * 能逐题比出谁在哪个领域更强。
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
    bg.addColorStop(0, "#080A11");
    bg.addColorStop(1, "#141826");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 顶部强调条：用当日第一个领域的真实主题色
    const leadColor = DOMAINS.find((m) => m.id === props.domains[0])?.color ?? "#FF6A2B";
    const accent = ctx.createLinearGradient(0, 0, W, 0);
    accent.addColorStop(0, leadColor);
    accent.addColorStop(1, "#FF9257");
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 8);

    // 标题
    ctx.fillStyle = "#EEF1F8";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.fillText(`${props.emoji} 通识局${props.label ? " · " + props.label : ""}`, 72, 108);

    ctx.fillStyle = "#99A3BD";
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText(props.date, 72, 158);

    // 分数
    ctx.fillStyle = "#FF6A2B";
    ctx.font = "bold 150px system-ui, sans-serif";
    ctx.fillText(String(props.score), 68, 320);

    ctx.fillStyle = "#99A3BD";
    ctx.font = "30px system-ui, sans-serif";
    ctx.fillText("分", 72 + ctx.measureText(String(props.score)).width + 24, 320);

    // 星级：画成矢量五角星（不用 emoji —— 跨平台字形不一致）
    const starR = 24;
    for (let i = 0; i < Math.max(1, props.stars); i++) {
      ctx.fillStyle = "#FFC24B";
      drawStar(ctx, 84 + i * (starR * 2 + 10), 378, starR);
    }

    // 右侧信息
    const infoX = 620;
    ctx.fillStyle = "#EEF1F8";
    ctx.font = "34px system-ui, sans-serif";
    ctx.fillText(`答对 ${props.correct} / ${props.total} 题`, infoX, 210);

    if (props.maxCombo >= 2) {
      ctx.fillStyle = "#FFC24B";
      ctx.font = "34px system-ui, sans-serif";
      ctx.fillText(`最高 ${props.maxCombo} 连击`, infoX, 262);
    }
    if (props.streak > 0) {
      ctx.fillStyle = "#FFC24B";
      ctx.font = "34px system-ui, sans-serif";
      ctx.fillText(`连续 ${props.streak} 天`, infoX, 314);
    }

    // PK 码：双方对账的凭据
    if (props.pkCode) {
      ctx.fillStyle = "#5FA8FF";
      ctx.font = "bold 38px system-ui, sans-serif";
      ctx.fillText(`PK ${props.pkCode}`, infoX, 366);
    }

    // 领域标签
    let x = infoX;
    const y = props.pkCode ? 452 : 396;
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

    // 同题方块网格：5 格 = 5 题
    if (props.cells && props.cells.length > 0) {
      const size = 62;
      const gap = 14;
      const startX = 72;
      const gridY = 470;
      ctx.font = "22px system-ui, sans-serif";
      props.cells.forEach((cell, i) => {
        const cx = startX + i * (size + gap);
        const color = DOMAINS.find((m) => m.id === cell.domain)?.color ?? "#99A3BD";
        ctx.fillStyle = cell.correct ? color : "rgba(251,113,133,.35)";
        roundRect(ctx, cx, gridY, size, size, 12);
        ctx.fill();
        if (!cell.correct) {
          ctx.strokeStyle = "rgba(251,113,133,.8)";
          ctx.lineWidth = 2;
          roundRect(ctx, cx, gridY, size, size, 12);
          ctx.stroke();
        }
      });
    }

    // 页脚
    ctx.fillStyle = "#66708C";
    ctx.font = "26px system-ui, sans-serif";
    ctx.fillText(
      props.pkCode ? "同一个 PK 码 · 同一份题 · tongshi-ju" : "每天三域，各显所长 · tongshi-ju",
      72,
      H - 56
    );

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

/**
 * 画一个实心五角星。
 *
 * 不用 emoji：emoji 在不同系统/浏览器上的字形、大小、基线都不一样，
 * 成绩卡是要发到社交平台给别人看的 —— 必须是稳定可控的矢量图形。
 */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Orbit, Sparkles, Star, TrendingUp } from "lucide-react";

import { DOMAINS, domainColor, domainName } from "@/content/domains";
import { domainIcon } from "@/components/domain/DomainCard";
import { getMastery, masteryStars } from "@/lib/storage";
import type { DomainId } from "@/types";

const SIZE = 400;
const CX = SIZE / 2;
const CY = SIZE / 2;
/** 最外圈半径（熟练度 100%）。 */
const R_MAX = 120;
/** 轴标签距最外圈的距离。 */
const LABEL_GAP = 26;
/** 网格圈数。 */
const RINGS = 4;

/** 领域名简称：取「·」之前的部分，避免标签过长挤在一起。 */
function shortName(name: string): string {
  const i = name.indexOf("·");
  return i > 0 ? name.slice(0, i) : name;
}

/** 知识星图：12 域雷达图，轴 = 领域，半径 = 熟练度。 */
export default function MapPage() {
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMastery(getMastery());
    setReady(true);
  }, []);

  const stats = useMemo(() => {
    const per = new Map<DomainId, { total: number; stars: number }>();
    for (const d of DOMAINS) per.set(d.id, { total: 0, stars: 0 });
    for (const [key, value] of Object.entries(mastery)) {
      const [domain, topic] = key.split("|");
      const p = per.get(domain as DomainId);
      if (!p) continue;
      p.total += 1;
      p.stars += masteryStars(value);
    }
    return per;
  }, [mastery]);

  /** 熟练度占比（0-1）：与明细条的进度口径一致。 */
  const ratioOf = useMemo(() => {
    const map = new Map<DomainId, number>();
    for (const d of DOMAINS) {
      const s = stats.get(d.id) ?? { total: 0, stars: 0 };
      const cap = Math.max(1, d.topics.length * 5);
      map.set(d.id, Math.min(1, s.stars / cap));
    }
    return map;
  }, [stats]);

  if (!ready) return null;

  const angleOf = (index: number) => (index / DOMAINS.length) * Math.PI * 2 - Math.PI / 2;
  const pointAt = (index: number, r: number) => {
    const a = angleOf(index);
    return { x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r };
  };

  const ringPath = (k: number) => {
    const r = (R_MAX * k) / RINGS;
    const pts = DOMAINS.map((_, i) => {
      const p = pointAt(i, r);
      return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    });
    return `M ${pts.join(" L ")} Z`;
  };

  // 数据顶点：每个领域一个点，半径 = 熟练度（相对最强领域缩放）
  const maxRatio = Math.max(0, ...Array.from(ratioOf.values()));
  const dataPoints = DOMAINS.map((d, i) => {
    const rel = maxRatio > 0 ? (ratioOf.get(d.id) ?? 0) / maxRatio : 0;
    return pointAt(i, rel * R_MAX);
  });

  /** 扇形：一段轴区间用该领域的色半透明填充。 */
  const wedgePath = (i: number) => {
    const a = dataPoints[i];
    const b = dataPoints[(i + 1) % DOMAINS.length];
    return `M ${CX} ${CY} L ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)} Z`;
  };

  const outlinePath = `M ${dataPoints
    .map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" L ")} Z`;

  const totalStars = Array.from(stats.values()).reduce((s, v) => s + v.stars, 0);
  const litDomains = Array.from(stats.values()).filter((v) => v.stars > 0).length;
  const strongest = DOMAINS.reduce(
    (best, d) => ((ratioOf.get(d.id) ?? 0) > (ratioOf.get(best.id) ?? 0) ? d : best),
    DOMAINS[0]
  );
  const strongestRatio = ratioOf.get(strongest.id) ?? 0;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Orbit size={20} className="text-info" aria-hidden />
          知识星图
        </h1>
        <p className="text-sm text-muted">
          每答对一个知识点点亮一颗星。数据只存在你自己的浏览器里。
        </p>
      </header>

      {/* 速览 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Star size={13} className="text-gold" aria-hidden />
            已点亮
          </div>
          <div className="tabular mt-1 text-xl font-bold text-accent">{totalStars}</div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Sparkles size={13} className="text-accent" aria-hidden />
            点亮领域
          </div>
          <div className="tabular mt-1 text-xl font-bold">
            {litDomains} / {DOMAINS.length}
          </div>
        </div>
        <div className="panel p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <TrendingUp size={13} className="text-success" aria-hidden />
            最强领域
          </div>
          <div
            className="mt-1 truncate text-xl font-bold"
            style={{ color: domainColor(strongest.id) }}
          >
            {domainName(strongest.id)}
          </div>
        </div>
      </div>

      {/* 雷达图 */}
      <div className="panel animate-fade-in p-4">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-dim">强弱分布</span>
          <span className="text-xs text-dim">满圈 = 当前最强领域</span>
        </div>
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="mx-auto h-auto w-full max-w-md"
          role="img"
          aria-label="12 个知识领域的熟练度雷达图，轴为领域，半径为熟练度"
        >
          {/* 网格：同心十二边形 + 辐射轴 */}
          <g className="text-border" fill="none" stroke="currentColor" strokeWidth={1}>
            {[1, 2, 3, 4].map((k) => (
              <path key={k} d={ringPath(k)} />
            ))}
            {DOMAINS.map((d, i) => {
              const p = pointAt(i, R_MAX);
              return <line key={d.id} x1={CX} y1={CY} x2={p.x.toFixed(2)} y2={p.y.toFixed(2)} />;
            })}
          </g>

          {/* 领域扇形：各用自己的主题色半透明 */}
          {DOMAINS.map((d, i) => (
            <path
              key={d.id}
              d={wedgePath(i)}
              style={{ fill: domainColor(d.id), fillOpacity: 0.2 }}
            />
          ))}

          {/* 数据轮廓 */}
          <path
            d={outlinePath}
            className="text-fg"
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.28}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />

          {/* 顶点（未点亮的域不画点，避免全部堆在圆心） */}
          {DOMAINS.map((d, i) => {
            const rel = maxRatio > 0 ? (ratioOf.get(d.id) ?? 0) / maxRatio : 0;
            if (rel <= 0) return null;
            return (
              <circle
                key={d.id}
                cx={dataPoints[i].x.toFixed(2)}
                cy={dataPoints[i].y.toFixed(2)}
                r={3.5}
                className="text-bg"
                stroke="currentColor"
                strokeWidth={1.5}
                style={{ fill: domainColor(d.id) }}
              />
            );
          })}

          {/* 轴标签 */}
          {DOMAINS.map((d, i) => {
            const a = angleOf(i);
            const r = R_MAX + LABEL_GAP;
            const x = CX + Math.cos(a) * r;
            const y = CY + Math.sin(a) * r;
            const cos = Math.cos(a);
            const anchor = cos > 0.25 ? "start" : cos < -0.25 ? "end" : "middle";
            const s = stats.get(d.id) ?? { total: 0, stars: 0 };
            return (
              <g key={d.id}>
                <text
                  x={x.toFixed(2)}
                  y={y.toFixed(2)}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={500}
                  className="text-muted"
                  fill="currentColor"
                >
                  {shortName(domainName(d.id))}
                </text>
                <text
                  x={x.toFixed(2)}
                  y={(y + 13).toFixed(2)}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={10}
                  className="text-dim"
                  fill="currentColor"
                >
                  {s.stars > 0 ? `${s.stars} 星` : "未点亮"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 各域明细 */}
      <div className="space-y-2">
        {DOMAINS.map((d) => {
          const s = stats.get(d.id) ?? { total: 0, stars: 0 };
          const Icon = domainIcon(d.id);
          const cap = Math.max(1, d.topics.length * 5);
          const pct = Math.min(1, s.stars / cap);
          return (
            <div key={d.id} className="panel flex items-center gap-3 p-3">
              <span
                aria-hidden
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
                style={{ background: `${domainColor(d.id)}22`, color: domainColor(d.id) }}
              >
                <Icon size={17} strokeWidth={2.1} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{domainName(d.id)}</span>
                  {!d.enabled && (
                    <span className="rounded-pill bg-surface-3 px-2 py-0.5 text-[10px] text-muted">
                      筹备中
                    </span>
                  )}
                  <span className="tabular ml-auto shrink-0 text-xs text-muted">
                    {s.stars} 星 · {s.total} 知识点
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2"
                  role="img"
                  aria-label={`${domainName(d.id)} 熟练度 ${Math.round(pct * 100)}%`}
                >
                  <div
                    className="h-full w-full origin-left rounded-pill transition-transform duration-base"
                    style={{ transform: `scaleX(${pct})`, background: domainColor(d.id) }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {strongestRatio === 0 && (
        <p className="text-center text-xs text-dim">还没有点亮任何领域 —— 先答一局每日挑战。</p>
      )}
    </div>
  );
}

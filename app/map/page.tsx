"use client";

import { useEffect, useMemo, useState } from "react";

import { DOMAINS, domainColor, domainEmoji, domainName } from "@/content/domains";
import { getMastery, masteryStars } from "@/lib/storage";
import type { DomainId } from "@/types";

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R_OUTER = 132;
const R_INNER = 86;

/** 知识星图：12 域环形布局，每个知识点用实心点表示星级。 */
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

  if (!ready) return null;

  const angleOf = (index: number) => (index / DOMAINS.length) * Math.PI * 2 - Math.PI / 2;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold">🌌 知识星图</h1>
        <p className="mt-1 text-sm text-muted">
          每答对一个知识点点亮一颗星。数据只存在你自己的浏览器里。
        </p>
      </header>

      <div className="panel flex justify-center p-4">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-auto w-full max-w-sm"
          role="img"
          aria-label="12 个知识领域的熟练度星图"
        >
          {/* 底圈 */}
          <circle
            cx={CX}
            cy={CY}
            r={(R_OUTER + R_INNER) / 2}
            fill="none"
            stroke="#2a2f3a"
            strokeWidth={R_OUTER - R_INNER}
          />

          {DOMAINS.map((d, i) => {
            const a = angleOf(i);
            const x = CX + Math.cos(a) * ((R_OUTER + R_INNER) / 2);
            const y = CY + Math.sin(a) * ((R_OUTER + R_INNER) / 2);
            const s = stats.get(d.id) ?? { total: 0, stars: 0 };
            const intensity = Math.min(1, s.stars / 10);
            return (
              <g key={d.id} opacity={d.enabled ? 1 : 0.32}>
                <circle
                  cx={x}
                  cy={y}
                  r={R_INNER + 8}
                  fill={domainColor(d.id)}
                  opacity={0.1 + intensity * 0.45}
                />
                <text x={x} y={y - 3} textAnchor="middle" fontSize="17" dominantBaseline="middle">
                  {domainEmoji(d.id)}
                </text>
                <text x={x} y={y + 15} textAnchor="middle" fontSize="9" fill="#8b93a1">
                  {s.stars > 0 ? `${s.stars}★` : "未点亮"}
                </text>
              </g>
            );
          })}

          <text x={CX} y={CY - 6} textAnchor="middle" fontSize="11" fill="#8b93a1">
            已点亮
          </text>
          <text
            x={CX}
            y={CY + 14}
            textAnchor="middle"
            fontSize="20"
            fontWeight="700"
            fill="#FF5C1A"
          >
            {Array.from(stats.values()).reduce((s, v) => s + v.stars, 0)}
          </text>
        </svg>
      </div>

      {/* 各域明细 */}
      <div className="space-y-2">
        {DOMAINS.map((d) => {
          const s = stats.get(d.id) ?? { total: 0, stars: 0 };
          return (
            <div key={d.id} className="panel p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{domainEmoji(d.id)}</span>
                <span className="font-medium">{domainName(d.id)}</span>
                <span className="tabular ml-auto text-sm text-muted">
                  {s.stars} ★ · {s.total} 个知识点
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (s.stars / (d.topics.length * 5)) * 100)}%`,
                    background: domainColor(d.id),
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

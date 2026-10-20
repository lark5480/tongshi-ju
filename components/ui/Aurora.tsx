"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { domainColor } from "@/content/domains";
import { dayKey } from "@/lib/engine/date";
import { getDailySession, getProfile } from "@/lib/storage";

/** `#RRGGBB` → `rgba(...)`。 */
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6) return `rgba(255, 106, 43, ${alpha})`;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(255, 106, 43, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 星云背景注入器 —— 「星轨」母题的落地。
 *
 * 把玩家**当前领域**的主题色写进 CSS 变量 `--nebula-1/2/3`，
 * `app/globals.css` 的 `body::before` 用它们画三层径向渐变。
 *
 * 于是"选了什么领域"会直接改变整个页面的氛围 —— 这是 12 域体系
 * 在视觉上唯一说得出口的表达方式。
 *
 * 无渲染输出（返回 null），只做副作用。
 */
export function Aurora() {
  const pathname = usePathname();

  useEffect(() => {
    // 优先用当日锁定会话的领域（含盲盒轮转的 2 个轮换域），否则回落到档案里的本命
    const session = getDailySession(dayKey());
    const domains = session?.domains?.length ? session.domains : getProfile().domains;

    const colors = domains.length
      ? domains.map((d) => domainColor(d))
      : ["#FF6A2B", "#5FA8FF", "#7C3AED"];

    const root = document.documentElement;
    root.style.setProperty("--nebula-1", rgba(colors[0] ?? "#FF6A2B", 0.22));
    root.style.setProperty("--nebula-2", rgba(colors[1] ?? colors[0] ?? "#5FA8FF", 0.16));
    root.style.setProperty("--nebula-3", rgba(colors[2] ?? colors[0] ?? "#7C3AED", 0.14));
  }, [pathname]);

  return null;
}

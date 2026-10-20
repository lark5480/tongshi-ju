"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Calendar, House, NotebookPen, Orbit, Swords, Users } from "lucide-react";

/**
 * 顶部导航。
 *
 * 改造要点：
 * - **emoji → Lucide SVG**：跨平台字形一致，描边统一，与站内图形语言一致；
 * - 激活态用 `accent` 的 12% 底 + 强调字色，不再靠加粗硬撑层级；
 * - 导航项命中区 ≥ 44px（移动端红线）。
 */
const LINKS = [
  { href: "/", label: "首页", icon: House },
  { href: "/daily", label: "每日", icon: Calendar },
  { href: "/pk", label: "同题", icon: Users },
  { href: "/duel", label: "对战", icon: Swords },
  { href: "/map", label: "星图", icon: Orbit },
  { href: "/wrong", label: "错题", icon: NotebookPen },
  { href: "/history", label: "战绩", icon: BarChart3 },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg-soft/85 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-1.5 py-2.5 font-bold tracking-tight"
          aria-label="通识局 首页"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-accent-soft to-accent text-white shadow-glow-sm">
            <Orbit size={16} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="text-[15px]">通识局</span>
        </Link>

        <nav className="no-scrollbar -mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1 py-1.5">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm
                  transition-colors duration-fast ${
                    active
                      ? "bg-accent/15 font-semibold text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-fg"
                  }`}
              >
                <Icon size={15} strokeWidth={active ? 2.3 : 1.9} aria-hidden />
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

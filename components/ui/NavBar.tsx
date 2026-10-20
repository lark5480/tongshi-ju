"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 顶部导航。高亮当前页面。 */
const LINKS = [
  { href: "/", label: "首页", icon: "🏠" },
  { href: "/daily", label: "每日", icon: "📅" },
  { href: "/duel", label: "对战", icon: "⚔️" },
  { href: "/map", label: "星图", icon: "🌌" },
  { href: "/wrong", label: "错题", icon: "📕" },
  { href: "/history", label: "战绩", icon: "📊" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 font-bold">
          <span className="text-lg">🎯</span>
          <span className="text-[15px] tracking-tight">通识局</span>
        </Link>

        <nav className="no-scrollbar -mx-1 flex flex-1 items-center gap-1 overflow-x-auto px-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-[#e8eaed]"
                }`}
              >
                <span className="mr-1">{l.icon}</span>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

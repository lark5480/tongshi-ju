import type { Metadata, Viewport } from "next";

import "./globals.css";
import { NavBar } from "@/components/ui/NavBar";
import { Aurora } from "@/components/ui/Aurora";

export const metadata: Metadata = {
  title: "通识局 · 每天三域，各显所长",
  description: "选三个本命知识领域，每天五题跨域快闪，和朋友同一题面抢答，看谁先按下答案。",
  keywords: ["知识问答", "每日挑战", "通识", "多域闯关", "抢答对战"],
};

export const viewport: Viewport = {
  themeColor: "#080A11",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full">
        {/* 星云背景注入：把当前领域的主题色写进 CSS 变量 */}
        <Aurora />
        <NavBar />
        <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">{children}</main>
      </body>
    </html>
  );
}

import type { Config } from "tailwindcss";

/**
 * 《通识局》设计 Token —— 「星轨 / Orbit」
 *
 * 语义色是**唯一**的取值入口：组件里不写裸 hex。
 * 12 个知识领域的主题色不在这里 —— 它们是用户可识别的身份标识，
 * 住在 `content/domains/index.ts`，按需内联注入。
 *
 * 设计规范见 docs/design/ui-system.md。
 */

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- 底色层：深空 ----
        bg: "#080A11",
        "bg-soft": "#0D1018",
        // ---- 表面层 ----
        surface: "#141826",
        "surface-2": "#1C2132",
        "surface-3": "#252B3E",
        // ---- 描边 ----
        border: "#29304A",
        "border-strong": "#3A4363",
        // ---- 文本 ----
        fg: "#EEF1F8",
        muted: "#99A3BD",
        dim: "#66708C",
        // ---- 强调与状态 ----
        accent: "#FF6A2B",
        "accent-soft": "#FF9257",
        gold: "#FFC24B",
        success: "#34D399",
        danger: "#FB7185",
        info: "#5FA8FF",
      },
      borderRadius: {
        sm: "10px",
        DEFAULT: "14px",
        md: "14px",
        lg: "20px",
        xl: "24px",
        pill: "999px",
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,.05) inset, 0 12px 32px -20px rgba(0,0,0,.95)",
        pop: "0 0 0 1px rgba(255,255,255,.08), 0 6px 18px -8px rgba(0,0,0,.8)",
        // 发光阴影跟随 --glow-color（由领域色内联注入）
        glow: "0 10px 34px -14px var(--glow-color, #FF6A2B)",
        "glow-sm": "0 6px 20px -10px var(--glow-color, #FF6A2B)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "180ms",
        slow: "280ms",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        flame: {
          "0%,100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.15)" },
        },
        /** 答错：轻微横向抖动（不夸张，280ms） */
        shake: {
          "0%,100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-2px)" },
          "80%": { transform: "translateX(2px)" },
        },
        /** 落位：轻微回弹（得分、徽章） */
        "pop-in": {
          "0%": { transform: "scale(0.94)", opacity: "0" },
          "60%": { transform: "scale(1.02)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        /** 上浮：得分数字飘起 */
        rise: {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "25%": { opacity: "1" },
          "100%": { transform: "translateY(-14px)", opacity: "0" },
        },
        /** 连击链推进：横向填充（用 transform，不动 width） */
        "chain-fill": {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        /** 倒计时告急：轻微缩放脉冲 */
        "pulse-soft": {
          "0%,100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
        /** 星星点亮 */
        "star-pop": {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "70%": { transform: "scale(1.15)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.2s ease-out infinite",
        "fade-in": "fade-in 0.25s ease-out",
        flame: "flame 1.6s ease-in-out infinite",
        shake: "shake 280ms cubic-bezier(.36,.07,.19,.97)",
        "pop-in": "pop-in 320ms cubic-bezier(.34,1.56,.64,1)",
        rise: "rise 900ms cubic-bezier(.22,1,.36,1) forwards",
        "chain-fill": "chain-fill 320ms cubic-bezier(.22,1,.36,1) forwards",
        "pulse-soft": "pulse-soft 1.2s ease-in-out infinite",
        "star-pop": "star-pop 420ms cubic-bezier(.34,1.56,.64,1)",
      },
    },
  },
  plugins: [],
};

export default config;

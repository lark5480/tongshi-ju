import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0f1115",
        surface: "#171a21",
        "surface-2": "#1f232c",
        border: "#2a2f3a",
        accent: "#FF5C1A",
        "accent-soft": "#ff7a45",
        muted: "#8b93a1",
        success: "#2ecc71",
        danger: "#e74c3c",
        warn: "#f1c40f",
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
      },
      animation: {
        "pulse-ring": "pulse-ring 1.2s ease-out infinite",
        "fade-in": "fade-in 0.25s ease-out",
        flame: "flame 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

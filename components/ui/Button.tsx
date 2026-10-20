import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  children?: ReactNode;
}

/**
 * 按钮 —— 全站唯一的点击基元。
 *
 * 触屏尺寸红线：主路径按钮最小 44px（`md`）/`lg` 48px；
 * `sm` 仅用于非主路径（标签行、卡片角落），并靠 ≥8px 间距保证命中率。
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-accent-soft to-accent text-white shadow-glow " +
    "hover:brightness-110 active:brightness-95 " +
    "disabled:from-surface-3 disabled:to-surface-3 disabled:text-dim disabled:shadow-none",
  secondary:
    "border border-border bg-surface-2 text-fg " +
    "hover:border-border-strong hover:bg-surface-3 " +
    "disabled:border-border disabled:bg-surface-2 disabled:text-dim",
  ghost: "bg-transparent text-muted hover:bg-surface-2 hover:text-fg " + "disabled:text-dim",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-[36px] px-3 py-1.5 text-sm",
  md: "min-h-[44px] px-4 py-2 text-sm",
  lg: "min-h-[48px] px-5 py-3 text-base",
};

/**
 * 按钮的视觉类。
 *
 * 单独导出是为了让 `<Link>` 能**直接**长得像按钮 ——
 * `<a>` 里嵌 `<button>` 是非法 HTML（两个可交互元素嵌套），
 * 而且外层 `<a>` 会退化成行内盒，命中区只剩 20px 高。
 */
export function buttonClass(variant: Variant = "primary", size: Size = "md", block = false) {
  return `inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md font-semibold
        transition-all duration-fast active:scale-[.98] disabled:cursor-not-allowed disabled:active:scale-100
        ${VARIANTS[variant]} ${SIZES[size]} ${block ? "w-full" : ""}`;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={`${buttonClass(variant, size, block)} ${className}`} {...rest}>
      {children}
    </button>
  );
}

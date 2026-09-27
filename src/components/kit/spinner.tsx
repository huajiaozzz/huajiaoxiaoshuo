import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 加载指示器 —— 渐变双环 spinner（图形与原 HeroUI 完全一致）。
 *
 * 外圈 `.spinner` 负责旋转与尺寸（`animate-spin-fast`），svg 用 currentColor
 * 的两段渐变画环，因此颜色跟着 `spinner--{color}` 变体走，深浅色主题自动适配。
 */
export type SpinnerProps = React.ComponentProps<"span"> & {
  /** 视觉尺寸，默认 md（24px） */
  size?: "sm" | "md" | "lg" | "xl";
  /** 环的颜色主题，默认 accent（跟随 --accent） */
  color?: "accent" | "current" | "danger" | "success" | "warning";
};

export function Spinner({
  size = "md",
  color = "accent",
  className,
  ...props
}: SpinnerProps) {
  const id = React.useId();
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("spinner", `spinner--${color}`, `spinner--${size}`, className)}
      {...props}
    >
      <svg data-slot="spinner-icon" viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id={`spin-a-${id}`} x1="50%" x2="50%" y1="5.271%" y2="91.793%">
            <stop offset="0%" stopColor="currentColor" />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id={`spin-b-${id}`} x1="50%" x2="50%" y1="15.24%" y2="87.15%">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
          </linearGradient>
        </defs>
        <g fill="none">
          <path d="M8.749.021a1.5 1.5 0 0 1 .497 2.958A7.5 7.5 0 0 0 3 10.375a7.5 7.5 0 0 0 7.5 7.5v3c-5.799 0-10.5-4.7-10.5-10.5C0 5.23 3.726.865 8.749.021" fill={`url(#spin-a-${id})`} transform="translate(1.5 1.625)" />
          <path d="M15.392 2.673a1.5 1.5 0 0 1 2.119-.115A10.48 10.48 0 0 1 21 10.375c0 5.8-4.701 10.5-10.5 10.5v-3a7.5 7.5 0 0 0 5.007-13.084a1.5 1.5 0 0 1-.115-2.118" fill={`url(#spin-b-${id})`} transform="translate(1.5 1.625)" />
        </g>
      </svg>
    </span>
  );
}

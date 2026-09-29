import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * 状态芯片 —— 原 HeroUI Chip 的替代。
 *
 * 类名映射与原版的 tailwind-variants 配置逐一对应，包括一个**容易踩的细节**：
 * `variant` 默认是 "secondary"（`.chip--secondary` 总是打上），`color` 只有
 * default/accent/success/warning/danger 五种有对应类 —— 原版没有 "info"，
 * 传了也只会渲染成默认样式，这里保持同样的"静默降级"。
 *
 * 字符串/数字子节点会自动包一层 `.chip__label`（原版行为），JSX 子节点原样渲染。
 */
const CHIP_COLOR_CLASS: Record<string, string | undefined> = {
  default: "chip--default",
  accent: "chip--accent",
  success: "chip--success",
  warning: "chip--warning",
  danger: "chip--danger",
};

// motion 组件的事件签名与原生 span 的重名（onAnimationStart 等），先剔掉再扩展
export type ChipProps = Omit<
  React.ComponentProps<"span">,
  "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration" | "onDragStart" | "onDragEnd" | "onDrag" | "onTransitionEnd"
> & {
  /** 默认/强调/成功/警告/危险；其它值（如 "info"）静默降级为无色 */
  color?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "soft" | "tertiary";
  /** 选中态（动画用；不传则看 className 里有没有 chip--selected） */
  isSelected?: boolean;
};

export function Chip({
  color = "default",
  size,
  variant = "secondary",
  className,
  isSelected,
  children,
  ...props
}: ChipProps) {
  return (
    <motion.span
      data-slot="chip"
      whileTap={{ scale: 0.94 }}
      animate={{ scale: isSelected ?? className?.includes("chip--selected") ? 1.04 : 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 20 }}
      className={cn(
        "chip",
        `chip--${variant}`,
        CHIP_COLOR_CLASS[color],
        size && `chip--${size}`,
        className,
      )}
      {...props}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <span className="chip__label">{children}</span>
      ) : (
        children
      )}
    </motion.span>
  );
}

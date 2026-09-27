import type { HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";
import { Button as MotionButton } from "@/components/animate-ui/primitives/buttons/button";

/**
 * 按钮 —— 项目自有的按钮组件（原 HeroUI Button 的替代）。
 *
 * 外观规格由 src/styles/kit/components/button.css 定义（`.button` + 变体类），
 * 这里只负责把 props 映射成类名与交互行为：
 *   - 底座用 Animate UI 的 Button（motion），按压 `tapScale 0.97` 比 CSS 的
 *     `:active` 缩放更顺（spring 归位）；hover **不放大**（hoverScale 1），
 *     保持原版"hover 只换底色"的克制。
 *   - `onPress`（原 HeroUI 的回调名）与 `onClick` 都收，迁移期两种写法都能用。
 *   - `isPending`：打 `data-pending` 走 CSS 的 status-pending，并吞掉点击，
 *     防止提交期间二次触发。
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "ghost"
  | "outline"
  | "danger"
  | "danger-soft";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<HTMLMotionProps<"button">, "type" | "children"> & {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 只放图标：宽高相等（w-10 md:w-9） */
  isIconOnly?: boolean;
  fullWidth?: boolean;
  /** 加载中：不可再点，视觉走 status-pending */
  isPending?: boolean;
  /** 原 HeroUI 的禁用写法 */
  isDisabled?: boolean;
  /** 原 HeroUI 的回调名 */
  onPress?: () => void;
  type?: "button" | "submit" | "reset";
};

export function Button({
  variant = "primary",
  size = "md",
  isIconOnly,
  fullWidth,
  isPending,
  isDisabled,
  onPress,
  onClick,
  type = "button",
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <MotionButton
      type={type}
      hoverScale={1}
      tapScale={0.97}
      data-pending={isPending ? "true" : undefined}
      aria-busy={isPending || undefined}
      disabled={disabled || isDisabled || isPending}
      onClick={(e) => {
        if (isPending) return;
        onPress?.();
        onClick?.(e);
      }}
      className={cn(
        "button",
        `button--${variant}`,
        `button--${size}`,
        isIconOnly && "button--icon-only",
        fullWidth && "button--full-width",
        className,
      )}
      {...props}
    >
      {children}
    </MotionButton>
  );
}

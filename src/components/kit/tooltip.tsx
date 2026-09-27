import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip as MotionTooltip,
  TooltipProvider,
  TooltipTrigger as MotionTooltipTrigger,
  TooltipContent as MotionTooltipContent,
} from "@/components/animate-ui/primitives/animate/tooltip";

/**
 * 提示气泡 —— 原 HeroUI Tooltip 的替代（Tooltip + Tooltip.Trigger + Tooltip.Content）。
 *
 * 底座换成 Animate UI 的动画气泡（spring 入场、跟随触发元素），外观仍是
 * `.tooltip` 那套（overlay 底色 + 圆角 + 阴影）。
 * 开合延迟沿用原版语义：`delay` 是悬停多久后出现、`closeDelay` 是移开后多久消失
 * （原版默认 1500ms / 500ms，来自 --tooltip-delay / --tooltip-close-delay）。
 */
export type TooltipProps = {
  children: React.ReactNode;
  /** 悬停多久后出现（毫秒） */
  delay?: number;
  /** 移开后多久消失（毫秒） */
  closeDelay?: number;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
};

function TooltipRoot({
  children,
  delay = 1500,
  closeDelay = 500,
  side = "top",
  align = "center",
  sideOffset = 0,
}: TooltipProps) {
  return (
    <TooltipProvider openDelay={delay} closeDelay={closeDelay}>
      <MotionTooltip side={side} align={align} sideOffset={sideOffset}>
        {children}
      </MotionTooltip>
    </TooltipProvider>
  );
}

function TooltipTrigger({
  className,
  ...props
}: React.ComponentProps<typeof MotionTooltipTrigger>) {
  return (
    <MotionTooltipTrigger
      className={cn("tooltip__trigger", className)}
      {...props}
    />
  );
}

function TooltipContent({
  className,
  ...props
}: React.ComponentProps<typeof MotionTooltipContent>) {
  return (
    <MotionTooltipContent className={cn("tooltip", className)} {...props} />
  );
}

export const Tooltip = Object.assign(TooltipRoot, {
  Trigger: TooltipTrigger,
  Content: TooltipContent,
});

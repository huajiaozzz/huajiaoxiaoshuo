import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 卡片容器 —— 原 HeroUI Card 的替代。
 *
 * `.card` 自带 p-4 + 阴影 + 圆角，调用方用 className 覆盖 padding 等
 * （Tailwind 工具类在 utilities 层，胜过 components 层的默认值）。
 */
export type CardProps = React.ComponentProps<"div"> & {
  variant?: "default" | "secondary" | "tertiary" | "transparent";
};

export function Card({
  variant = "default",
  className,
  ...props
}: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn("card", `card--${variant}`, className)}
      {...props}
    />
  );
}

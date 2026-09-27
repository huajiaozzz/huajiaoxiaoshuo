import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 开关 —— 原 HeroUI Switch 的替代（结构照旧：Content 包 Control + Thumb + 文字）。
 *
 * 选中态的视觉由 CSS 从**根元素**的 `data-selected` 派生（`.switch[data-selected] …`），
 * 可点的其实是 `Switch.Content`（role="switch"，读屏器读到的是它）——
 * 这正是原版 React Aria SwitchField + SwitchButton 的分工，结构保持一致。
 */
type SwitchContextValue = { isSelected: boolean; onChange: (value: boolean) => void };
const SwitchContext = React.createContext<SwitchContextValue | null>(null);

export type SwitchProps = Omit<
  React.ComponentProps<"div">,
  "onChange" | "children"
> & {
  isSelected: boolean;
  onChange: (value: boolean) => void;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
};

function SwitchRoot({
  isSelected,
  onChange,
  size = "md",
  className,
  children,
  ...props
}: SwitchProps) {
  const ctx = React.useMemo(() => ({ isSelected, onChange }), [isSelected, onChange]);
  return (
    <div
      data-slot="switch"
      data-selected={isSelected || undefined}
      className={cn("switch", `switch--${size}`, className)}
      {...props}
    >
      <SwitchContext.Provider value={ctx}>{children}</SwitchContext.Provider>
    </div>
  );
}

function SwitchContent({ className, children, ...props }: React.ComponentProps<"button">) {
  const ctx = React.use(SwitchContext);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ctx?.isSelected ?? false}
      data-slot="switch-content"
      className={cn("switch__content", className)}
      onClick={() => ctx?.onChange(!ctx.isSelected)}
      {...props}
    >
      {children}
    </button>
  );
}

function SwitchControl({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="switch-control"
      className={cn("switch__control", className)}
      {...props}
    />
  );
}

function SwitchThumb({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="switch-thumb"
      className={cn("switch__thumb", className)}
      {...props}
    />
  );
}

export const Switch = Object.assign(SwitchRoot, {
  Content: SwitchContent,
  Control: SwitchControl,
  Thumb: SwitchThumb,
});

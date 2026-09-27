import type { ReactNode } from "react";
import {
  Highlight,
  HighlightItem,
} from "@/components/animate-ui/primitives/effects/highlight";

export type SegmentedOption<T extends string> = { value: T; label: string; icon?: ReactNode };

/**
 * 分段视图切换（伏笔 / 时间线页共用的 ViewSwitch）。
 *
 * 选中药丸用 Highlight 的共享 layoutId 滑到新段上，替代原先「点了就静态换底色」；
 * 外观沿用原来的选中态（黑药丸 + 白字 + 细阴影），颜色只用 Tailwind neutral 类。
 * 弹簧参数与 SlidingTabs 的指示器一致（stiffness 300 / damping 30），手感「跟手」。
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-black/5 bg-white/70 p-1 dark:border-white/5 dark:bg-neutral-900/50">
      <Highlight
        controlledItems
        value={value}
        click={false}
        exitDelay={0}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute inset-0 rounded-lg bg-neutral-900 shadow-sm"
      >
        {options.map((option) => (
          <HighlightItem key={option.value} value={option.value}>
            <button
              type="button"
              onClick={() => onChange(option.value)}
              className={
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition " +
                "data-[active=false]:opacity-60 data-[active=false]:hover:bg-black/5 data-[active=false]:hover:opacity-100 " +
                "dark:data-[active=false]:hover:bg-white/10 data-[active=true]:text-white"
              }
            >
              {option.icon}
              {option.label}
            </button>
          </HighlightItem>
        ))}
      </Highlight>
    </div>
  );
}

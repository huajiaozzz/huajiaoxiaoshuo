import type { ReactNode } from "react";
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number";

/**
 * 数字滚动显示 —— Animate UI 的 SlidingNumber 的项目封装。
 *
 * 数值变化时**逐位滑动**（不是整段跳变），首次挂载从 0 滚入到目标值。
 * 调用方只需要给一个 number，不用关心 spring 参数与千分位细节。
 *
 * 减弱动效：main.tsx 里全局包了 `<MotionConfig reducedMotion="user">`，
 * 系统开启"减少动态效果"时 spring 会自动退化为直接落位，不需要这里再判断。
 */
export function AnimatedNumber({
  value,
  decimalPlaces,
  prefix,
  suffix,
  thousandSeparator = ",",
  initiallyStable = false,
  inView = false,
  delay,
  className,
}: {
  /** 目标数值 */
  value: number;
  /** 小数位；不给则按整数渲染（整数位仍会逐位滑动） */
  decimalPlaces?: number;
  /** 数字前的固定文本，如货币符号 */
  prefix?: ReactNode;
  /** 数字后的固定文本，如单位"字" */
  suffix?: ReactNode;
  /** 千分位字符；传 undefined 关闭 */
  thousandSeparator?: string | undefined;
  /** true 则首次显示目标值、不从 0 滚入（用于不想强调入场的地方） */
  initiallyStable?: boolean;
  /** true 则进入视口才开始动画 */
  inView?: boolean;
  /** 延迟启动（毫秒） */
  delay?: number;
  className?: string;
}) {
  return (
    <span className={className}>
      {prefix}
      <SlidingNumber
        number={value}
        decimalPlaces={decimalPlaces}
        thousandSeparator={thousandSeparator}
        initiallyStable={initiallyStable}
        inView={inView}
        delay={delay}
      />
      {suffix}
    </span>
  );
}

/** 「前缀 + 数字 + 后缀」型字符串，如 "¥1.23"、"12,345 字"、"35.0%" */
const STAT_VALUE_RE = /^([^\d]{0,4}?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s;

/**
 * 给 StatCard 这类"值是格式化好的字符串"的地方做数字滚动。
 *
 * 会把 "12,345 字" 拆成 数字 + " 字" 两段，只让数字滚动；
 * 拆不出来（"—"、"刚刚"）或负数（SlidingNumber 的负号渲染不稳）就原样渲染。
 * 这样 30+ 处 StatCard 调用点**一行都不用改**。
 */
export function AnimatedStatValue({ value }: { value: ReactNode }) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? <AnimatedNumber value={value} /> : <>{value}</>;
  }
  if (typeof value !== "string") return <>{value}</>;

  const m = STAT_VALUE_RE.exec(value);
  if (!m) return <>{value}</>;
  const [, prefix, numText, suffix] = m;

  const n = Number(numText.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return <>{value}</>;

  const decimalPlaces = (numText.split(".")[1] ?? "").length;
  return (
    <>
      {prefix}
      <AnimatedNumber
        value={n}
        decimalPlaces={decimalPlaces || undefined}
        thousandSeparator={numText.includes(",") ? "," : undefined}
      />
      {suffix}
    </>
  );
}

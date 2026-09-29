import type { ReactNode } from "react";
import { Card, Chip, Spinner } from "@/components/kit";
import { Check } from "lucide-react";
import type { IssueSeverity } from "@/core";
import { AnimatedStatValue } from "@/components/common/AnimatedNumber";
import { Fade } from "@/components/animate-ui/primitives/effects/fade";
import { Zoom } from "@/components/animate-ui/primitives/effects/zoom";

/** 共享小组件：所有页面统一使用，避免各处重复造轮子。 */

/**
 * 入场动效统一手感：spring、约 300ms 落位、几乎不回弹。
 * 取 stiffness 220 / damping 26 —— 比"默认弹簧"更稳，卡片和列表落位时不会弹一下。
 * 各文件各自持有同款常量（而非从这里导出）：oxlint 的 only-export-components
 * 不允许组件文件导出对象常量（会破坏 Fast Refresh），宁可重复一行也不动 lint 配置。
 */
const ENTER = { type: "spring", stiffness: 220, damping: 26 } as const;

export function SectionTitle({ children, hint, action }: { children: ReactNode; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
        {hint && <p className="mt-0.5 text-xs opacity-55">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  /**
   * 色调。
   * `info` 是补上的 —— 之前代码里有 4 处 `tone: "info"`，
   * 但类型里没有它，TypeScript 会把它们当默认色处理（静默退化，不报错）。
   */
  tone?: "default" | "accent" | "info" | "success" | "warning" | "danger";
}) {
  const toneClass: Record<string, string> = {
    default: "text-neutral-500",
    /*
      accent 的图标用主题色（而不是中性灰）。
      这是"强调"唯一保留的表达方式 —— 只体现在一个小图标上，
      既看得出哪张卡是主角，又不会在两种主题下都变成一块反色板。
    */
    accent: "text-[var(--accent)]",
    info: "text-sky-500",
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-rose-500",
  };
  /*
    ## 为什么没有"实心强调卡"了
    accent 原先会渲染成一块**实心反色卡**：浅色主题下是纯黑、深色主题下是纯白。
    用户指出两个方向都别扭 —— 深色主题里冒出一张白卡、浅色主题里冒出一张黑卡，
    它跟周围所有卡片都是"反着"的，看起来像渲染错误而不是强调。
    参考图里确实有深色块，但那要求**整页所有卡片都按同一套配色语言排布**；
    我们这里 accent 散落在十几处（"本章字数""全书字数""角色"…），
    语义上并不都是"最该突出的那一个"，所以那种实心块只会显得随机。
    现在 accent 与其它色调一视同仁：一层同色淡渐变 + 主色图标。
    主题若仍想要实心块，覆盖 --tone-solid-bg / --tone-solid-fg 即可（.tone-solid 仍保留）。
  */
  const gradient = tone === "default" ? "" : "tone-gradient tone-gradient-" + tone;

  return (
    <Card className={"p-4 " + gradient}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs opacity-55">{label}</p>
        {icon && <span className={toneClass[tone]}>{icon}</span>}
      </div>
      {/* 数字逐位滚动（"12,345 字" 这类字符串会被拆成数字+单位，只滚数字） */}
      <p className="tabular mt-2 text-xl font-semibold tracking-tight">
        <AnimatedStatValue value={value} />
      </p>
      {hint && <p className="mt-1 text-[11px] opacity-45">{hint}</p>}
    </Card>
  );
}

export function EmptyHint({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  /*
    空状态是"唯一没有内容可看"的时刻，值得一次很轻的入场：
    整体淡入落位，图标轻微放大一次（Zoom 只放一次，不做持续浮动——
    空态常出现在列表/筛选切换后，反复晃动会烦）。
    两处都用 asChild 直接把动效并到现有节点上，不引入额外包裹 div，布局零影响。
  */
  return (
    <Fade asChild inView inViewOnce transition={ENTER}>
      <div className="grid place-items-center rounded-xl border border-dashed border-black/10 px-6 py-14 text-center dark:border-white/10">
        {icon && (
          <Zoom asChild inView inViewOnce initialScale={0.9} transition={ENTER}>
            <div className="mb-3 opacity-25">{icon}</div>
          </Zoom>
        )}
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-1.5 max-w-sm text-xs leading-relaxed opacity-55">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </Fade>
  );
}

/*
  为什么 Loading 不加入场动效：Spinner 本身就在动，已经表达"正在加载"；
  再叠一层淡入只是让加载态晚 200ms 才被看清，纯属拖慢感知。
*/
export function Loading({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-sm opacity-60">
      <Spinner size="sm" />
      {label}
    </div>
  );
}

const SEVERITY_META: Record<IssueSeverity, { label: string; color: "danger" | "warning" | "accent" | "default" }> = {
  blocker: { label: "阻断", color: "danger" },
  error: { label: "严重", color: "danger" },
  warn: { label: "警告", color: "warning" },
  info: { label: "提示", color: "accent" },
};

export function SeverityChip({ severity }: { severity: IssueSeverity }) {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.info;
  return (
    <Chip size="sm" color={meta.color}>
      {meta.label}
    </Chip>
  );
}

export function Tag({ children, color = "default" }: { children: ReactNode; color?: "default" | "accent" | "success" | "warning" | "danger" }) {
  return (
    <Chip size="sm" color={color}>
      {children}
    </Chip>
  );
}

/**
 * 进度条（纯 CSS，无依赖）。
 * 颜色用静态映射 —— `bg-${tone}-500` 这类动态类 Tailwind 不会生成，进度条会隐形。
 * 默认 accent 走 `var(--accent)`，跟随主题（项目已中性化，不要写死 violet）。
 */
const PROGRESS_TONE: Record<string, string> = {
  accent: "var(--accent)",
  default: "var(--foreground)",
  success: "var(--color-emerald-500, #10b981)",
  warning: "var(--color-amber-500, #f59e0b)",
  danger: "var(--color-rose-500, #f43f5e)",
  info: "var(--color-sky-500, #0ea5e9)",
};

export function Progress({ value, max, tone = "accent" }: { value: number; max: number; tone?: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const background = PROGRESS_TONE[tone] ?? PROGRESS_TONE.accent;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10">
      <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background }} />
    </div>
  );
}

/** 两栏布局：左列表右详情 */
export function SplitPane({ left, right, leftWidth = 300 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) {
  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="shrink-0 overflow-y-auto" style={{ width: leftWidth }}>
        {left}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto">{right}</div>
    </div>
  );
}

/** 键值展示行 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 py-1.5 text-sm">
      <span className="opacity-50">{label}</span>
      <span className="whitespace-pre-wrap leading-relaxed">{children}</span>
    </div>
  );
}

/**
 * 可选芯片：选中态**一定看得见**。
 *
 * 为什么必须用它、不能自己写 `color={选中 ? "accent" : "default"}`：
 * HeroUI v3 的 Chip 底色恒为 --default，`.chip--accent` 只改文字色；
 * 而本主题的品牌色已改成中性灰（与默认文字色同值），于是那种写法渲染出来
 * 完全一样 —— 全站 16 处选择控件都变成「点了没反应」。详见 globals.css 第 3 节。
 *
 * 选中时的外观（底色 + 内描边 + 加粗 + 勾）由 `.chip--selected` 负责，
 * 颜色跟随 currentColor，所以传语义色（warning / danger）也成立。
 */
export function SelectChip({
  selected,
  onPress,
  children,
  color = "accent",
  className,
  label,
}: {
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
  /** 语义色：默认中性；严重度之类的筛选可传 warning / danger / success */
  color?: "accent" | "success" | "warning" | "danger";
  className?: string;
  /** 无障碍名（芯片文字不足以说明用途时给） */
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onPress}
      className={"transition active:scale-95 " + (className ?? "")}
    >
      <Chip size="sm" color={selected ? color : "default"} isSelected={selected} className={selected ? "chip--selected" : undefined}>
        {selected && <Check className="mr-0.5 inline size-3" />}
        {children}
      </Chip>
    </button>
  );
}

import { createContext, useContext, useId, type KeyboardEvent, type ReactNode } from "react";
import {
  Tabs,
  TabsHighlight,
  TabsHighlightItem,
  TabsList,
  TabsTrigger,
  useTabs,
} from "@/components/animate-ui/primitives/animate/tabs";
import { cn } from "@/lib/utils";

export type SlidingTabItem = { value: string; label: ReactNode };

/** 让面板与它的 tab 用同一 id 前缀关联起来（aria-labelledby） */
const SlidingTabsIdContext = createContext("");

/**
 * 滑动指示器标签栏（Animate UI Tabs + Highlight）。
 *
 * 选中药丸（--segment 白底 + --surface-shadow 细阴影 + radius*3 圆角）借 Highlight 的
 * 共享 layoutId 平滑滑到新标签上，取代原先画在 HeroUI .tabs__tab 上的静态选中态
 * —— 那套外观的来历与弯路记录在 globals.css 的旧注释里，视觉沿用，只是会滑了。
 *
 * 只接管标签栏：面板仍是「只挂载当前页」的条件渲染（SlidingTabsPanel），
 * 与原来 HeroUI Tabs.Panel 的行为和间距（mt-4 p-2）保持一致。
 */
export function SlidingTabs({
  items,
  value,
  onChange,
  ariaLabel,
  listClassName,
  children,
}: {
  items: SlidingTabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  listClassName?: string;
  children?: ReactNode;
}) {
  const idPrefix = useId();
  return (
    <SlidingTabsIdContext.Provider value={idPrefix}>
      <Tabs value={value} onValueChange={onChange} className="flex w-full flex-col gap-2">
        <TabList items={items} ariaLabel={ariaLabel} className={listClassName} />
        {children}
      </Tabs>
    </SlidingTabsIdContext.Provider>
  );
}

/** 标签栏本体：灰色轨道 + 滑动药丸 + 方向键切换 */
function TabList({
  items,
  ariaLabel,
  className,
}: {
  items: SlidingTabItem[];
  ariaLabel?: string;
  className?: string;
}) {
  const { handleValueChange } = useTabs();
  const idPrefix = useContext(SlidingTabsIdContext);

  // 方向键「焦点即选中」，与 HeroUI Tabs 的行为一致：原生按钮只有 Tab 能挪焦点，
  // 不补这段就丢了 ARIA 标签页的键盘操作。
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    if (next === null) return;
    event.preventDefault();
    buttons[next]?.focus();
    handleValueChange(items[next].value);
  };

  return (
    <TabsList
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        // 轨道/药丸的底色与圆角尺寸沿用 HeroUI 原 tabs：轨道 radius*2.5，药丸 radius*3
        "flex w-full items-center rounded-[calc(var(--radius)*2.5)] bg-[var(--default)] p-1",
        className,
      )}
    >
      <TabsHighlight
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        exitDelay={0}
        className="absolute inset-0 rounded-[calc(var(--radius)*3)] bg-[var(--segment)]"
        style={{ boxShadow: "var(--surface-shadow)" }}
      >
        {items.map((item) => (
          <TabsHighlightItem key={item.value} value={item.value} className="min-w-0 flex-1">
            <TabsTrigger
              value={item.value}
              type="button"
              id={idPrefix + "-" + item.value}
              className={
                "flex h-8 w-full items-center justify-center rounded-[calc(var(--radius)*3)] px-4 text-sm font-medium transition-colors " +
                "text-muted data-[state=inactive]:hover:text-foreground data-[state=active]:text-[color:var(--segment-foreground)]"
              }
            >
              {item.label}
            </TabsTrigger>
          </TabsHighlightItem>
        ))}
      </TabsHighlight>
    </TabsList>
  );
}

/** 面板：只渲染选中的那个（未选中即卸载，与原来 Tabs.Panel 相同） */
export function SlidingTabsPanel({ value, children }: { value: string; children: ReactNode }) {
  const { activeValue } = useTabs();
  const idPrefix = useContext(SlidingTabsIdContext);
  if (activeValue !== value) return null;
  return (
    <div role="tabpanel" aria-labelledby={idPrefix + "-" + value} className="mt-4 p-2">
      {children}
    </div>
  );
}

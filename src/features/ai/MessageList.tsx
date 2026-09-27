import { useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { Chip } from "@/components/kit";
import { Check, ChevronDown, ChevronRight, Copy, Sparkles } from "lucide-react";
import type { ChatMessage, ContextSource, ID } from "@/core";
import { useAppStore } from "@/app/store";
import { AnimatedNumber } from "@/components/common/AnimatedNumber";
import { Fade } from "@/components/animate-ui/primitives/effects/fade";
import { Zoom } from "@/components/animate-ui/primitives/effects/zoom";
import { formatDuration } from "@/utils/format";
import { formatTokens } from "@/utils/tokens";
import { Markdown } from "./Markdown";
import { SOURCE_KIND_LABELS, fallbackSources, type RunMeta } from "./meta";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 transition hover:opacity-100"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {/* 勾选图标弹入、1.2s 后淡出换回；mode="wait" 让新旧元素不叠影 */}
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <Zoom
            key="check"
            asChild
            initialScale={0.4}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
            exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.12 } }}
          >
            <Check className="size-3 text-emerald-500" />
          </Zoom>
        ) : (
          <Fade key="copy" asChild transition={{ duration: 0.12 }}>
            <Copy className="size-3" />
          </Fade>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <Fade key="done" asChild transition={{ duration: 0.12 }}>
            <span>已复制</span>
          </Fade>
        ) : (
          <Fade key="idle" asChild transition={{ duration: 0.12 }}>
            <span>复制</span>
          </Fade>
        )}
      </AnimatePresence>
    </button>
  );
}

const METRIC_RE = /^([^\d]{0,4}?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s;

/**
 * "1.2k"、"3秒" 这类格式化数值：只有数字逐位滚动，单位文字不动。
 * 不直接用 AnimatedStatValue 是因为它不透传 initiallyStable / delay ——
 * 历史消息要直接落位（不然切一次会话满屏数字翻滚），刚生成完的那条才随所在行滚一次到位。
 */
function RollingMetric({
  text,
  initiallyStable,
  delay,
}: {
  text: string;
  initiallyStable: boolean;
  delay?: number;
}) {
  const m = METRIC_RE.exec(text);
  if (!m) return <>{text}</>;
  const [, prefix, numText, suffix] = m;
  const n = Number(numText.replace(/,/g, ""));
  // 负数的负号走 SlidingNumber 自己的渲染，手感不稳，这里原样展示
  if (!Number.isFinite(n) || n < 0) return <>{text}</>;
  return (
    <>
      {prefix}
      <AnimatedNumber
        value={n}
        decimalPlaces={(numText.split(".")[1] ?? "").length || undefined}
        thousandSeparator={numText.includes(",") ? "," : undefined}
        initiallyStable={initiallyStable}
        delay={delay}
      />
      {suffix}
    </>
  );
}

/** 助手消息下方的用量 / 引用来源（折叠展示） */
function AssistantFooter({
  message,
  meta,
  onInspect,
  delay = 0,
  isFresh = false,
}: {
  message: ChatMessage;
  meta?: RunMeta;
  onInspect?: () => void;
  /** 与所在消息行入场同步的延迟：行还没显形时数字不先滚完 */
  delay?: number;
  /** 刚生成完的最新一条数字滚入一次，历史消息直接落位 */
  isFresh?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sources: ContextSource[] = meta?.sources ?? fallbackSources(message.citations, message.contextSources);
  const usage = message.usage;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] opacity-55">
        <button
          type="button"
          className="inline-flex items-center gap-1 transition hover:opacity-100"
          onClick={() => {
            setOpen((v) => !v);
            onInspect?.();
          }}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          引用来源 {sources.length}
        </button>
        {usage && usage.total > 0 && (
          <span className="tabular">
            token <RollingMetric text={formatTokens(usage.prompt)} initiallyStable={!isFresh} delay={delay} /> 入 /{" "}
            <RollingMetric text={formatTokens(usage.completion)} initiallyStable={!isFresh} delay={delay} /> 出
          </span>
        )}
        {meta?.model && <span className="truncate">{meta.model}</span>}
        {meta && (
          <span className="tabular">
            <RollingMetric text={formatDuration(meta.ms)} initiallyStable={!isFresh} delay={delay} />
          </span>
        )}
        <CopyButton text={message.content} />
      </div>

      {open && (
        <div className="mt-1.5 space-y-1 rounded-lg border border-black/5 bg-black/[0.02] p-2 dark:border-white/5 dark:bg-white/[0.03]">
          {sources.length === 0 ? (
            <p className="text-[11px] opacity-45">这一轮没有引用任何素材。</p>
          ) : (
            sources.map((source, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="opacity-45">{SOURCE_KIND_LABELS[source.kind] ?? source.kind} · </span>
                  {source.label}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {source.trimmed && (
                    <Chip size="sm" color="warning">
                      截断
                    </Chip>
                  )}
                  <span className="tabular opacity-45">{source.tokens > 0 ? formatTokens(source.tokens) : "—"}</span>
                </span>
              </div>
            ))
          )}
          {meta?.error && <p className="pt-1 text-[11px] leading-relaxed text-rose-500">{meta.error}</p>}
        </div>
      )}
    </div>
  );
}

/** 消息列表 + 流式打字气泡 */
export function MessageList({
  messages,
  streamText,
  reasoning,
  meta,
  empty,
  onInspect,
}: {
  messages: ChatMessage[];
  streamText?: string | null;
  reasoning?: string;
  meta: Record<ID, RunMeta>;
  empty: ReactNode;
  onInspect?: (id: ID) => void;
}) {
  const notify = useAppStore((s) => s.notify);

  if (messages.length === 0 && !streamText) return <>{empty}</>;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {messages.map((message, index) => {
        if (message.role === "system") return null;
        const isUser = message.role === "user";
        // 从最新一条往前错开 50ms、封顶 300ms：聊天区总是看着底部，
        // 刚发出 / 刚生成完的消息第一时间入场，历史消息依次补上，长对话最后一条也不会等太久
        const delay = Math.min(messages.length - 1 - index, 6) * 50;
        return (
          <Fade
            key={message.id}
            className={isUser ? "flex justify-end" : "flex justify-start"}
            // Fade 只管透明度，把 12px 上移叠进同一套 variants，免得为两段动画套两层包装；
            // animate 停在 visible，流式更新的重渲染不会重播，只在挂载时播一次
            variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
            transition={{ type: "spring", stiffness: 220, damping: 26 }}
            delay={delay}
          >
            <div className={"min-w-0 " + (isUser ? "max-w-[85%]" : "w-full")}>
              {isUser ? (
                <div className="rounded-2xl rounded-br-md bg-black/[0.06] px-3.5 py-2.5 text-sm whitespace-pre-wrap">
                  {message.content}
                </div>
              ) : (
                <div className="w-full">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium opacity-50">
                    <Sparkles className="size-3" />
                    创作助手
                  </div>
                  <div
                    className={
                      "rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm " +
                      (message.error
                        ? "border-rose-500/30 bg-rose-500/[0.06]"
                        : "border-black/5 bg-white/70 dark:border-white/5 dark:bg-white/[0.04]")
                    }
                  >
                    <Markdown text={message.content} />
                  </div>
                  <AssistantFooter
                    message={message}
                    meta={meta[message.id]}
                    delay={delay}
                    isFresh={index === messages.length - 1}
                    onInspect={() => onInspect?.(message.id)}
                  />
                </div>
              )}
            </div>
          </Fade>
        );
      })}

      {streamText !== null && streamText !== undefined && (
        <div className="flex justify-start">
          <div className="w-full">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium opacity-50">
              <Sparkles className="size-3 animate-pulse" />
              创作助手 · 正在生成
            </div>
            <div className="rounded-2xl rounded-bl-md border border-neutral-900/20 bg-white/70 px-3.5 py-2.5 text-sm dark:bg-white/[0.04]">
              {reasoning ? (
                <details className="mb-2">
                  <summary className="cursor-pointer text-[11px] opacity-50">思考过程</summary>
                  <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap opacity-60">{reasoning}</p>
                </details>
              ) : null}
              {streamText ? (
                <Markdown text={streamText} />
              ) : (
                <span className="text-xs opacity-50">正在等待模型响应…</span>
              )}
              {/* 流式光标：animate/cursor 的 Cursor 是跟随鼠标的自定义指针（隐藏系统光标、监听 pointermove），
                  语义完全不同；这里保留方块，换成更细腻的呼吸闪烁，prefers-reduced-motion 由全局 CSS 规则兜底 */}
              <span className="animate-pulse-soft ml-0.5 inline-block h-3.5 w-1.5 rounded-sm bg-neutral-900 align-text-bottom dark:bg-neutral-100" />
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-[11px] opacity-45">
              <button
                type="button"
                className="transition hover:opacity-100"
                onClick={() => void navigator.clipboard?.writeText(streamText)}
              >
                复制当前内容
              </button>
              <button
                type="button"
                className="transition hover:opacity-100"
                onClick={() => notify("info", "生成结束后会自动保存", "中途取消不会丢失已经写出的内容")}
              >
                说明
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

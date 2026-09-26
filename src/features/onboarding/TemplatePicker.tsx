import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Input, Label, TextArea, TextField } from "@heroui/react";
import { RefreshCw, Search, Settings2, Sparkles } from "lucide-react";
import { SelectChip } from "@/components/common/ui";
import {
  filterTemplates,
  NOVEL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABEL,
  type LengthClass,
  type NovelTemplate,
  type PovStyle,
  type TemplateCategory,
} from "@/core";
import { getProvider, listProviders, resolveModel } from "@/db/repo/settings";
import { generateTopics } from "@/ai/topic-gen";
import { useAppStore } from "@/app/store";
import { useOpenSettings } from "@/app/useOpenSettings";

type Mode = "library" | "ai";

const LENGTH_TEXT: Record<LengthClass, string> = {
  short: "短篇",
  novella: "中篇",
  novel: "长篇",
  epic: "超长篇",
  webnovel: "网文连载",
};

const POV_TEXT: Record<PovStyle, string> = {
  first: "第一人称",
  second: "第二人称",
  "third-limited": "第三人称限知",
  "third-omniscient": "第三人称全知",
  mixed: "多视角切换",
};

/**
 * 小说模板区：两种来源，同一套预填路径。
 *
 * · 内置模板库 —— 30 个写死的套路，离线可用、零 token；
 * · AI 选题 —— 围绕作者的灵感现出几个方向（人物、体裁、种子一起给），
 *   选中的结果形状与内置模板完全相同，所以「创建并用 AI 建档」怎么走，
 *   这条路径就怎么走。
 */
export function TemplatePicker({
  selectedId,
  onChange,
  genres = [],
  lengthClass,
  pov,
}: {
  selectedId?: string;
  onChange: (t: NovelTemplate | null) => void;
  /** 作者已经填过的偏好，作为 AI 出题的倾向 */
  genres?: string[];
  lengthClass?: LengthClass;
  pov?: PovStyle;
}) {
  const [mode, setMode] = useState<Mode>("library");
  const [category, setCategory] = useState<TemplateCategory>("all");
  const [query, setQuery] = useState("");

  // ---- AI 选题的状态 ----
  const [hint, setHint] = useState("");
  const [countDraft, setCountDraft] = useState("4");
  const [candidates, setCandidates] = useState<NovelTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const settings = useAppStore((s) => s.settings);
  const openSettings = useOpenSettings();
  const providers = useLiveQuery(() => listProviders(), [], undefined);

  /**
   * 能不能生成：用**真正会被调用的那个模型**判断（走任务路由 > 全局默认），
   * 与 runner / 一句话成书页保持一致。null = 还没查完，此时不要拿它禁用按钮。
   */
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const resolved = await resolveModel("brainstorm");
      if (!alive) return;
      if (!resolved.providerId || !resolved.model) {
        setModelReady(false);
        return;
      }
      const provider = await getProvider(resolved.providerId);
      if (!alive) return;
      setModelReady(Boolean(provider?.enabled));
    })();
    return () => {
      alive = false;
    };
  }, [providers, settings.activeProviderId, settings.activeModel]);

  const count = Math.max(2, Math.min(8, Number(countDraft) || 4));
  const list = useMemo(() => filterTemplates(NOVEL_TEMPLATES, category, query), [category, query]);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await generateTopics({
        hint,
        count,
        category,
        genres,
        lengthClass,
        pov,
        avoid: candidates.map((c) => c.name),
      });
      if (!res.ok) {
        setError(res.error ?? "生成失败");
        return;
      }
      setCandidates(res.candidates);
    } catch (e) {
      // 生成失败也要留在界面上，不能让弹窗看起来「点了没反应」
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="mb-0">创作模板</Label>
        <div className="flex rounded-lg border border-black/10 p-0.5 text-xs dark:border-white/15">
          {(
            [
              { id: "library" as Mode, label: "内置模板库" },
              { id: "ai" as Mode, label: "AI 选题" },
            ]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={
                "rounded-md px-2.5 py-1 transition " +
                (mode === m.id ? "bg-black/[0.07] font-medium dark:bg-white/[0.12]" : "opacity-55 hover:opacity-100")
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        {selectedId && (
          <button
            type="button"
            className="ml-auto text-xs opacity-55 transition hover:opacity-100"
            onClick={() => onChange(null)}
          >
            清除选择
          </button>
        )}
      </div>

      {mode === "library" ? (
        <>
          <CategoryChips value={category} onChange={setCategory} />

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 opacity-40" />
            <TextField value={query} onChange={setQuery}>
              <Label className="sr-only">搜索模板</Label>
              <Input placeholder="搜索模板…" className="pl-8" />
            </TextField>
          </div>

          {list.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 px-4 py-6 text-center text-xs opacity-50 dark:border-white/15">
              没有匹配的模板，换个关键词或分类试试，或者切到「AI 选题」让模型现出一个。
            </p>
          ) : (
            <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {list.map((t) => (
                <TemplateCard key={t.id} template={t} active={selectedId === t.id} onPick={onChange} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed opacity-55">
            给一句灵感或几个关键词，AI 出几条能直接开写的选题；点一条会带出书名、一句话故事、简介、体裁、篇幅与视角，
            其中的「种子」还会带进「一句话成书」。
          </p>

          <TextField value={hint} onChange={setHint} fullWidth>
            <Label className="sr-only">灵感或关键词</Label>
            <TextArea
              rows={2}
              placeholder="例如：雾港、能听见死者遗言的验尸官、记忆可以出租 —— 留空也行，AI 自己出题"
            />
          </TextField>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">倾向分类</span>
            <CategoryChips value={category} onChange={setCategory} allLabel="不限" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              生成
              <input
                type="number"
                min={2}
                max={8}
                value={countDraft}
                onChange={(e) => setCountDraft(e.target.value)}
                onBlur={() => setCountDraft(String(Math.max(2, Math.min(8, Number(countDraft) || 4))))}
                className="tabular w-12 rounded border border-black/10 bg-transparent px-1.5 py-0.5 text-center dark:border-white/15"
              />
              条
            </label>
            <Button
              className="ml-auto"
              size="sm"
              variant="primary"
              isDisabled={modelReady === false}
              isPending={busy}
              onPress={() => void run()}
            >
              {candidates.length ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
              {candidates.length ? "换一批" : "生成选题"}
            </Button>
          </div>

          {modelReady === false && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <span>还没有可用的模型：先选一个供应商并填 Key（本地模型需要在运行中）。</span>
              <Button size="sm" variant="ghost" onPress={() => openSettings("models")}>
                <Settings2 className="size-3.5" />
                打开设置
              </Button>
            </div>
          )}

          {error && (
            <div
              data-ai-error
              className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-xs leading-relaxed text-rose-600 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          {candidates.length > 0 && (
            <>
              <p className="text-xs font-medium">
                生成结果 · 共 {candidates.length} 条，点一条带进下面的表单
              </p>
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {candidates.map((t) => (
                  <TemplateCard key={t.id} template={t} active={selectedId === t.id} onPick={onChange} ai />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * 分类选择（内置库用来筛选，AI 选题用来定基调）。
 *
 * 统一走共享组件 SelectChip —— 它负责把选中态做成看得见的样子
 * （底色 + 内描边 + 加粗 + 勾）。背景见 components/common/ui.tsx 与 globals.css 第 3 节：
 * HeroUI 的 Chip 底色恒为 --default，`.chip--accent` 只改文字色，
 * 而本主题的品牌色是中性灰，两者渲染结果相同 —— 旧的 `color={... ? "accent" : "default"}`
 * 写法会让选中态完全不可见。
 */
function CategoryChips({
  value,
  onChange,
  allLabel = "全部",
}: {
  value: TemplateCategory;
  onChange: (c: TemplateCategory) => void;
  allLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TEMPLATE_CATEGORIES.map((c) => (
        <SelectChip key={c} selected={value === c} onPress={() => onChange(c)}>
          {c === "all" ? allLabel : TEMPLATE_CATEGORY_LABEL[c]}
        </SelectChip>
      ))}
    </div>
  );
}

/** 内置模板与 AI 选题共用一张卡片：形状一样，预填路径才不会分叉 */
function TemplateCard({
  template: t,
  active,
  onPick,
  ai = false,
}: {
  template: NovelTemplate;
  active: boolean;
  onPick: (t: NovelTemplate | null) => void;
  ai?: boolean;
}) {
  return (
    <button
      type="button"
      data-topic-card={t.id}
      onClick={() => onPick(active ? null : t)}
      className={
        "rounded-xl border p-3 text-left transition " +
        (active
          ? "border-black/40 bg-black/[0.04] ring-1 ring-black/20 dark:border-white/30 dark:bg-white/[0.06] dark:ring-white/20"
          : "border-black/8 hover:border-black/25 dark:border-white/10 dark:hover:border-white/25")
      }
    >
      <div className="flex items-start gap-1.5">
        <p className="text-sm font-medium">
          <span className="mr-1">{t.emoji}</span>
          {t.name}
        </p>
        {ai && (
          <span className="mt-0.5 shrink-0 rounded bg-black/80 px-1 py-px text-[10px] font-medium text-white dark:bg-white/85 dark:text-black">
            AI
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed opacity-60">{t.logline}</p>
      <p className="mt-1 text-[10px] opacity-45">
        {LENGTH_TEXT[t.lengthClass]} · {POV_TEXT[t.pov]}
        {t.genres.length ? " · " + t.genres.join("/") : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {t.tags.slice(0, 4).map((tag) => (
          <span
            key={tag}
            className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] opacity-70 dark:bg-white/[0.08]"
          >
            {tag}
          </span>
        ))}
      </div>
    </button>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, Chip, TextArea } from "@/components/kit";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Layers, Link2, PenLine, Plus, Save, ScanSearch, Wand2,
} from "lucide-react";
import type {
  BlueprintRecord, BookChapter, ChapterIntel, ChapterPlaybookEntry, CharacterRole, ID,
  WorldCategory,
} from "@/core";
import { findOverlaps } from "@/core";
import {
  deconstructChapterIntel, draftSlotVersion, imitateChapter, splitBookChapters,
} from "@/ai/blueprint";
import {
  createChapter, getChapterWithContent, listChapters, saveChapterContent,
} from "@/db/repo/outline";
import { updateBlueprint } from "@/db/repo/blueprint";
import { createCharacter, listCharacters } from "@/db/repo/cast";
import { listWorldEntries, upsertWorldEntry } from "@/db/repo/world";
import { useAppStore } from "@/app/store";
import { EmptyHint, SectionTitle } from "@/components/common/ui";
import { escapeHtml } from "@/utils/text";
import { formatWords } from "@/utils/format";

const NL = String.fromCharCode(10);

const CHARACTER_ROLES = new Set<CharacterRole>([
  "protagonist", "antagonist", "deuteragonist", "mentor", "foil", "love-interest", "sidekick", "minor", "cameo",
]);
const WORLD_CATEGORIES = new Set<WorldCategory>([
  "geography", "history", "politics", "magic", "technology", "religion",
  "economy", "species", "culture", "organization", "item", "language", "custom",
]);

/** 草稿在确认入库前可编辑，放在组件状态里（slotId → 草稿） */
interface SlotDraftState {
  kind: "character" | "world";
  name: string;
  role?: string;
  tagline?: string;
  body: string;
  category?: string;
  drafting: boolean;
}

/**
 * 对照仿写工作台：左边原书的一章（原文 / 本章阵型），右边这本书对应的章节。
 *
 * 数据流刻意分成两层：
 * - **拆书工作区**（BlueprintRecord 上的 bookMap / chapterIntel / bindings）：
 *   原书的棋子表、逐章阵型、对应表 —— 全是参照物，**不进项目库**；
 * - **项目库**（characters / worldEntries / chapterContents）：
 *   只有作者在对应表里绑定的「我的元素」和仿写保存的正文才入库，边写边入库。
 *
 * 防洗稿：功能位不记原书人名；仿写提示词只用「你的角色卡」；生成后自动跑原创性自检。
 */
export function ImitationStudio({ projectId, rows }: { projectId: ID; rows: BlueprintRecord[] }) {
  const notify = useAppStore((s) => s.notify);

  const [rowId, setRowId] = useState<ID | null>(null);
  const row: BlueprintRecord | null = rows.find((r) => r.id === rowId) ?? rows[0] ?? null;

  const split = useMemo(
    () => (row ? splitBookChapters(row.sourceText) : { chapters: [] as BookChapter[], byHeading: false }),
    [row],
  );
  const [chapterIdx, setChapterIdx] = useState(0);
  useEffect(() => setChapterIdx(0), [row?.id]);

  const original: BookChapter | null = split.chapters[chapterIdx] ?? null;

  // ---- 左栏：原文 / 本章阵型 ----
  const [leftTab, setLeftTab] = useState<"text" | "intel">("text");
  const [intelLoading, setIntelLoading] = useState(false);
  const intel: ChapterIntel | undefined = row?.chapterIntel?.[String(chapterIdx)];

  const ensureIntel = async () => {
    if (!row || !original || row.chapterIntel?.[String(chapterIdx)]) return;
    const bookMap = row.bookMap;
    if (!bookMap?.slots.length) {
      notify("warning", "这本书没有棋子表", "旧拆解没有全书棋子表，重新拆一次整本即可生成");
      return;
    }
    setIntelLoading(true);
    try {
      const res = await deconstructChapterIntel({
        projectId,
        slots: bookMap.slots,
        worldSlots: bookMap.worldSlots ?? [],
        causal: bookMap.causal ?? [],
        chapter: { title: original.title, text: original.text, words: original.words },
      });
      if (!res.ok || !res.intel) {
        notify("danger", "拆阵型失败", res.error);
        return;
      }
      await updateBlueprint(row.id, {
        chapterIntel: { ...(row.chapterIntel ?? {}), [String(chapterIdx)]: res.intel },
      });
      notify("success", "本章阵型已拆出", "节拍、出场位、埋收的坑都在左栏");
    } catch (e) {
      notify("danger", "拆阵型失败", e instanceof Error ? e.message : String(e));
    } finally {
      setIntelLoading(false);
    }
  };

  // ---- 作者这本书的数据 ----
  const chapters = useLiveQuery(() => listChapters(projectId), [projectId]);
  const list = chapters ?? [];
  const characters = useLiveQuery(() => listCharacters(projectId), [projectId]) ?? [];
  const worldEntries = useLiveQuery(() => listWorldEntries(projectId), [projectId]) ?? [];

  const [targetId, setTargetId] = useState<ID | null>(null);
  // 原书第 i 章 ↔ 我的第 i 章：翻原文章节时右侧自动跟上（手动选过就尊重手动选择）
  const [manualTarget, setManualTarget] = useState(false);
  useEffect(() => {
    if (manualTarget || list.length === 0) return;
    setTargetId(list[Math.min(chapterIdx, list.length - 1)]?.id ?? null);
  }, [chapters, chapterIdx, manualTarget]);

  const [draft, setDraft] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  useEffect(() => {
    if (!targetId) {
      setDraft("");
      return;
    }
    let alive = true;
    setLoadingContent(true);
    void getChapterWithContent(targetId).then((found) => {
      if (!alive) return;
      setDraft(found.content?.text ?? "");
      setLoadingContent(false);
    });
    return () => {
      alive = false;
    };
  }, [targetId]);

  // ---- 对应表：绑定 + 起草 ----
  const bindings = useMemo(() => row?.bindings ?? [], [row]);
  const bindingOf = (slotId: string) => bindings.find((b) => b.slotId === slotId);
  const [slotDrafts, setSlotDrafts] = useState<Record<string, SlotDraftState>>({});
  const [draftingSlot, setDraftingSlot] = useState<string | null>(null);

  const elementName = (kind: "character" | "world", refId?: ID) => {
    if (!refId) return null;
    return kind === "character"
      ? characters.find((c) => c.id === refId)?.name ?? null
      : worldEntries.find((w) => w.id === refId)?.title ?? null;
  };

  const setBinding = async (slotId: string, kind: "character" | "world", refId: ID | undefined) => {
    if (!row) return;
    const next = [
      ...bindings.filter((b) => b.slotId !== slotId),
      ...(refId ? [{ slotId, kind, refId }] : []),
    ];
    await updateBlueprint(row.id, { bindings: next });
  };

  const runDraftSlot = async (slotId: string, kind: "character" | "world") => {
    if (!row?.bookMap) return;
    const slot = row.bookMap.slots.find((s) => s.id === slotId);
    const wslot = row.bookMap.worldSlots?.find((s) => s.id === slotId);
    const slotName = slot?.slotName ?? wslot?.name ?? slotId;
    const fn = slot?.fn ?? wslot?.fn ?? "";
    if (!fn) return;
    setDraftingSlot(slotId);
    try {
      const res = await draftSlotVersion({
        projectId,
        kind,
        slotName,
        role: slot?.role,
        fn,
        traits: slot?.traits,
      });
      if (!res.ok || !res.draft) {
        notify("danger", "起草失败", res.error);
        return;
      }
      setSlotDrafts((s) => ({
        ...s,
        [slotId]: {
          kind, name: res.draft!.name, role: res.draft!.role, tagline: res.draft!.tagline,
          body: res.draft!.body, category: res.draft!.category, drafting: false,
        },
      }));
    } catch (e) {
      notify("danger", "起草失败", e instanceof Error ? e.message : String(e));
    } finally {
      setDraftingSlot(null);
    }
  };

  /** 确认入库：存的是可编辑的「你的版本」，入库后自动完成绑定 */
  const commitSlotDraft = async (slotId: string) => {
    const d = slotDrafts[slotId];
    if (!d || !d.name.trim()) {
      notify("warning", "草稿还没名字", "至少填一个名字再入库");
      return;
    }
    try {
      if (d.kind === "character") {
        const created = await createCharacter(projectId, {
          name: d.name.trim(),
          role: (CHARACTER_ROLES.has(d.role as CharacterRole) ? d.role : "minor") as CharacterRole,
          tagline: d.tagline,
          background: d.body,
        });
        await setBinding(slotId, "character", created.id);
        notify("success", "已入库并绑定", "人物「" + created.name + "」，可去人物页继续完善");
      } else {
        const created = await upsertWorldEntry(projectId, {
          title: d.name.trim(),
          category: (WORLD_CATEGORIES.has(d.category as WorldCategory) ? d.category : "culture") as WorldCategory,
          body: d.body,
        });
        await setBinding(slotId, "world", created.id);
        notify("success", "已入库并绑定", "设定「" + created.title + "」，可去世界观页继续完善");
      }
      setSlotDrafts((s) => {
        const { [slotId]: _removed, ...rest } = s;
        return rest;
      });
    } catch (e) {
      notify("danger", "入库失败", e instanceof Error ? e.message : String(e));
    }
  };

  // ---- 仿写 ----
  const [generating, setGenerating] = useState(false);
  const [genNote, setGenNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 原创性自检：当前草稿 vs 原书这一章 */
  const overlaps = useMemo(
    () => (draft.trim() && original ? findOverlaps(draft, original.text) : []),
    [draft, chapterIdx, row?.id],
  );

  const chapterCount = row?.blueprint.chapterTemplate.length ?? 0;
  const playbook: ChapterPlaybookEntry | undefined = useMemo(() => {
    if (!row) return undefined;
    if (row.playbook?.length) return row.playbook[chapterIdx % row.playbook.length];
    const ct = row.blueprint.chapterTemplate;
    return ct.length ? { ...ct[chapterIdx % ct.length], beats: [ct[chapterIdx % ct.length].function] } : undefined;
  }, [row, chapterIdx]);

  /** 本章出场且已绑定的「我的元素」卡片 → 进仿写提示词 */
  const boundCards = useMemo(() => {
    if (!row?.bookMap || !intel?.castSlotIds.length) return [];
    const cards: { slotName: string; card: string }[] = [];
    for (const slotId of intel.castSlotIds) {
      const slot = row.bookMap.slots.find((s) => s.id === slotId);
      const binding = bindingOf(slotId);
      if (!slot || !binding?.refId) continue;
      if (binding.kind === "character") {
        const c = characters.find((x) => x.id === binding.refId);
        if (c) {
          cards.push({
            slotName: slot.slotName,
            card: c.name + (c.tagline ? "（" + c.tagline + "）" : "") + (c.personality ? " 性格：" + c.personality : "") + (c.want ? " 想要：" + c.want : "") + (c.flaw ? " 缺陷：" + c.flaw : ""),
          });
        }
      } else {
        const w = worldEntries.find((x) => x.id === binding.refId);
        if (w) cards.push({ slotName: slot.slotName, card: w.title + "：" + w.body.slice(0, 160) });
      }
    }
    return cards;
  }, [row, intel, bindings, characters, worldEntries]);

  if (rows.length === 0 || !row || !original) {
    return (
      <EmptyHint
        icon={<PenLine className="size-9" />}
        title="先拆一本书，再来对照仿写"
        description="切到「拆书入库」把参考书贴进去拆解（整本最好，会自动分章）。拆完回到这里：左边原书章节、右边你的章节，一章一章对着写。"
      />
    );
  }

  const target = list.find((c) => c.id === targetId) ?? null;
  const draftWords = draft.replace(/\s+/g, "").length;
  const boundCount = bindings.filter((b) => b.refId).length;
  const totalSlots = (row.bookMap?.slots.length ?? 0) + (row.bookMap?.worldSlots?.length ?? 0);

  const runImitate = async () => {
    setGenerating(true);
    setGenNote(null);
    try {
      const res = await imitateChapter({
        projectId,
        technique: row.blueprint.technique,
        playbook,
        intel,
        boundCards,
        original: { title: original.title, text: original.text, words: original.words },
        target: target ? { title: target.title, summary: target.summary, goals: target.goals } : undefined,
        wordTarget: Math.max(1200, Math.min(4000, original.words)),
      });
      if (!res.ok || !res.text) {
        notify("danger", "仿写失败", res.error);
        return;
      }
      setDraft(res.text);
      setGenNote(
        "按原书「" + original.title + "」的写法生成了草稿"
        + (boundCards.length ? "（用了 " + boundCards.length + " 个你的绑定元素）" : "（本章还没绑定你的元素，只按写法起草）")
        + " —— 先看自检结果，改掉雷同再保存",
      );
      notify("success", "草稿已生成", "记得先看原创性自检结果");
    } catch (e) {
      notify("danger", "仿写失败", e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const saveToChapter = async (chapterId: ID, title: string) => {
    if (!draft.trim()) {
      notify("warning", "还没有内容", "先仿写或粘贴正文");
      return;
    }
    setSaving(true);
    try {
      const html = draft
        .split(/\n+/)
        .map((p) => "<p>" + escapeHtml(p.trim()) + "</p>")
        .join("");
      const res = await saveChapterContent(chapterId, html);
      if (!res.ok) {
        notify("warning", "保存冲突", "这一章刚在别处被更新过，刷新后再试");
        return;
      }
      notify("success", "已保存", "「" + title + "」" + formatWords(res.words));
    } finally {
      setSaving(false);
    }
  };

  const createAndSave = async () => {
    const created = await createChapter(projectId, { title: original.title });
    setManualTarget(true);
    setTargetId(created.id);
    await saveToChapter(created.id, created.title);
  };

  return (
    <div className="space-y-4">
      <SectionTitle hint="左边原书怎么写，右边你写什么；技法照做、内容全新，用到的元素在对应表里入库">对照仿写</SectionTitle>

      {/* 拆解记录切换 */}
      {rows.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setRowId(r.id);
                setManualTarget(false);
              }}
              className={
                "rounded-lg border px-2.5 py-1 text-xs transition " +
                (r.id === row.id
                  ? "border-black/30 bg-black/[0.04] font-medium dark:border-white/30 dark:bg-white/[0.06]"
                  : "border-black/8 opacity-60 hover:opacity-100 dark:border-white/10")
              }
            >
              {r.sourceTitle}
            </button>
          ))}
        </div>
      )}

      {!split.byHeading && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.05] px-3 py-2 text-[11px] leading-relaxed">
          没识别到章节标题，原书按 {split.chapters.length} 个片段兜底切分 —— 对照仍然可用，只是没有真正的「章」边界。
        </div>
      )}

      {/* 原书章节导航 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="上一章"
          isDisabled={chapterIdx === 0}
          onPress={() => setChapterIdx((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <span className="tabular text-xs opacity-70">
          原书第 {chapterIdx + 1} / {split.chapters.length} 章
        </span>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="下一章"
          isDisabled={chapterIdx >= split.chapters.length - 1}
          onPress={() => setChapterIdx((i) => Math.min(split.chapters.length - 1, i + 1))}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        <select
          value={chapterIdx}
          onChange={(e) => setChapterIdx(Number(e.target.value))}
          className="max-w-56 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
        >
          {split.chapters.map((c, i) => (
            <option key={i} value={i}>
              {i + 1}. {c.title}（{formatWords(c.words)}）
            </option>
          ))}
        </select>
        {playbook && (
          <Chip size="sm" color="accent">
            配方：{playbook.role}
          </Chip>
        )}
      </div>

      {/* 双屏 */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* 左：原书这一章（原文 / 本章阵型） */}
        <Card className="flex min-h-0 flex-col p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg border border-black/10 p-0.5 text-[11px] dark:border-white/15">
              {(
                [
                  { id: "text" as const, label: "原文" },
                  { id: "intel" as const, label: "本章阵型" },
                ]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setLeftTab(t.id)}
                  className={
                    "rounded-md px-2 py-0.5 transition " +
                    (leftTab === t.id ? "bg-black/[0.07] font-medium dark:bg-white/[0.12]" : "opacity-55 hover:opacity-100")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] opacity-50">{formatWords(original.words)}</span>
          </div>

          {leftTab === "text" ? (
            <div className="manuscript mt-2 max-h-[560px] min-h-72 flex-1 overflow-y-auto whitespace-pre-wrap border-t border-black/5 pt-2 text-[13px] leading-relaxed dark:border-white/10">
              {original.text}
            </div>
          ) : (
            <div className="mt-2 min-h-72 flex-1 space-y-2.5 overflow-y-auto border-t border-black/5 pt-2 text-[12px] leading-relaxed dark:border-white/10">
              {!intel ? (
                <div className="space-y-2">
                  <p className="opacity-60">
                    这一章还没拆阵型。拆一次就知道：原作者这章动用了哪些棋子、按什么节拍推进、埋收了哪个坑。
                  </p>
                  <Button size="sm" variant="outline" isPending={intelLoading} onPress={() => void ensureIntel()}>
                    <ScanSearch className="size-3.5" />
                    拆本章阵型（一次模型调用，结果缓存）
                  </Button>
                </div>
              ) : (
                <>
                  {intel.beats.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium opacity-70">事件节拍</p>
                      <ol className="mt-1 space-y-0.5">
                        {intel.beats.map((b, i) => (
                          <li key={i} className="opacity-80">{i + 1}. {b}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {intel.castSlotIds.length > 0 && (
                    <div>
                      <p className="text-[11px] font-medium opacity-70">出场棋子</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {intel.castSlotIds.map((id) => {
                          const slot = row.bookMap?.slots.find((s) => s.id === id);
                          const bound = elementName("character", bindingOf(id)?.refId);
                          return (
                            <Chip key={id} size="sm" color={bound ? "success" : "default"}>
                              {slot?.slotName ?? id}
                              {bound ? " → " + bound : "（未绑定）"}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {(intel.plant || intel.payoff) && (
                    <div className="rounded bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed">
                      {intel.plant && <p>埋坑：{intel.plant}</p>}
                      {intel.payoff && <p>收坑：{intel.payoff}</p>}
                    </div>
                  )}
                  {intel.hook && (
                    <p className="opacity-80"><span className="opacity-55">章末钩：</span>{intel.hook}</p>
                  )}
                </>
              )}
            </div>
          )}
        </Card>

        {/* 右：我的这一章 */}
        <Card className="flex min-h-0 flex-col p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <select
              value={targetId ?? ""}
              onChange={(e) => {
                setManualTarget(true);
                setTargetId((e.target.value || null) as ID | null);
              }}
              className="max-w-60 flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs dark:border-white/15"
            >
              {list.length === 0 && <option value="">（本书还没有章节）</option>}
              {list.map((c, i) => (
                <option key={c.id} value={c.id}>
                  我的第 {i + 1} 章 · {c.title}
                </option>
              ))}
            </select>
            <span className="text-[11px] opacity-50">{formatWords(draftWords)}</span>
          </div>

          {target?.summary && (
            <p className="mt-1.5 rounded bg-black/[0.03] px-2 py-1 text-[11px] leading-relaxed opacity-70 dark:bg-white/[0.05]">
              本章大纲：{target.summary}
            </p>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={loadingContent ? "正在读取章节内容…" : "点「AI 仿写本章」按原书写法起草，或直接把你的正文贴进来；保存会覆盖所选章节的全部内容。"}
            rows={14}
            className="manuscript mt-2 min-h-60 flex-1 resize-y rounded-lg border border-black/8 bg-transparent p-3 text-[13px] leading-relaxed outline-none focus:border-black/25 dark:border-white/10 dark:focus:border-white/30"
          />

          {overlaps.length > 0 ? (
            <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/[0.06] px-3 py-2 text-[11px] leading-relaxed">
              <p className="flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-300">
                <AlertTriangle className="size-3.5" />
                原创性自检：{overlaps.length} 处与原书这一章雷同（连续 12 字以上）
              </p>
              <ul className="mt-1 space-y-0.5 opacity-85">
                {overlaps.slice(0, 4).map((h, i) => (
                  <li key={i} className="truncate">
                    {h.text.slice(0, 60)}
                    <span className="ml-1 opacity-50">（{h.length} 字）</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 opacity-70">这些是照抄别人的句子，改写掉再保存。</p>
            </div>
          ) : draft.trim() ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <Check className="size-3.5" />
              原创性自检通过：与原书这一章没有连续 12 字以上的雷同
            </p>
          ) : null}

          {genNote && <p className="mt-2 text-[11px] leading-relaxed opacity-65">{genNote}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-black/5 pt-2 dark:border-white/10">
            <Button size="sm" variant="primary" isPending={generating} onPress={() => void runImitate()}>
              <Wand2 className="size-3.5" />
              AI 仿写本章
            </Button>
            <Button
              size="sm"
              variant="outline"
              isPending={saving}
              isDisabled={!targetId || !draft.trim()}
              onPress={() => targetId && target && void saveToChapter(targetId, target.title)}
            >
              <Save className="size-3.5" />
              保存到所选章节
            </Button>
            <Button size="sm" variant="ghost" isPending={saving} onPress={() => void createAndSave()}>
              <Plus className="size-3.5" />
              存为新章节
            </Button>
          </div>
        </Card>
      </div>

      {/* 对应表：功能位 → 我的元素（边写边入库的入口） */}
      {row.bookMap && totalSlots > 0 && (
        <details className="rounded-xl border border-black/8 px-4 py-3 dark:border-white/10">
          <summary className="cursor-pointer text-xs font-medium">
            <Link2 className="mr-1 inline size-3.5" />
            对应表 · 功能位绑定我的元素（{boundCount}/{totalSlots} 已绑定）—— 入库的是你的版本，不是原书内容
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-[11px] leading-relaxed opacity-60">
              原书的棋子只给功能代称（不记人名）。给每个位子绑上你的角色/设定：
              可以选已有的，也可以让 AI 按位子起草一份草稿，改完确认入库 —— 本章仿写会自动带上绑定的元素。
            </p>
            {row.bookMap.slots.map((slot) => {
              const b = bindingOf(slot.id);
              const boundName = elementName("character", b?.refId);
              const d = slotDrafts[slot.id];
              const usedHere = intel?.castSlotIds.includes(slot.id);
              return (
                <div
                  key={slot.id}
                  className={
                    "rounded-lg border px-3 py-2 text-[11px] leading-relaxed " +
                    (usedHere ? "border-black/25 dark:border-white/25" : "border-black/8 dark:border-white/10")
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{slot.slotName}</span>
                    {usedHere && <Chip size="sm" color="accent">本章出场</Chip>}
                    {boundName ? (
                      <Chip size="sm" color="success">已绑：{boundName}</Chip>
                    ) : (
                      <Chip size="sm">未绑定</Chip>
                    )}
                    <span className="opacity-55">{slot.fn}</span>
                  </div>
                  {slot.traits.length > 0 && (
                    <p className="mt-1 opacity-55">写法特征：{slot.traits.join("；")}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select
                      value={b?.refId ?? ""}
                      onChange={(e) => void setBinding(slot.id, "character", (e.target.value || undefined) as ID | undefined)}
                      className="max-w-52 rounded border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/15"
                    >
                      <option value="">绑定已有角色…</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      isPending={draftingSlot === slot.id}
                      onPress={() => void runDraftSlot(slot.id, "character")}
                    >
                      <Layers className="size-3.5" />
                      AI 按位起草
                    </Button>
                  </div>
                  {d && d.kind === "character" && (
                    <div className="mt-2 space-y-1.5 rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.05]">
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={d.name}
                          onChange={(e) => setSlotDrafts((s) => ({ ...s, [slot.id]: { ...d, name: e.target.value } }))}
                          placeholder="名字"
                          className="w-36 rounded border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/15"
                        />
                        <input
                          value={d.tagline ?? ""}
                          onChange={(e) => setSlotDrafts((s) => ({ ...s, [slot.id]: { ...d, tagline: e.target.value } }))}
                          placeholder="一句话定位"
                          className="min-w-48 flex-1 rounded border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/15"
                        />
                      </div>
                      <TextArea
                        rows={4}
                        value={d.body}
                        onChange={(e) => setSlotDrafts((s) => ({ ...s, [slot.id]: { ...d, body: e.target.value } }))}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onPress={() => void commitSlotDraft(slot.id)}>
                          <Check className="size-3.5" />
                          确认入库并绑定
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() =>
                            setSlotDrafts((s) => {
                              const { [slot.id]: _removed, ...rest } = s;
                              return rest;
                            })
                          }
                        >
                          丢弃
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(row.bookMap.worldSlots?.length ?? 0) > 0 && (
              <div className="border-t border-black/5 pt-2 dark:border-white/10">
                <p className="text-[11px] font-medium opacity-70">世界观装置</p>
                {row.bookMap!.worldSlots.map((slot) => {
                  const b = bindingOf(slot.id);
                  const boundName = elementName("world", b?.refId);
                  const d = slotDrafts[slot.id];
                  return (
                    <div key={slot.id} className="mt-2 rounded-lg border border-black/8 px-3 py-2 text-[11px] leading-relaxed dark:border-white/10">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{slot.name}</span>
                        {boundName ? <Chip size="sm" color="success">已绑：{boundName}</Chip> : <Chip size="sm">未绑定</Chip>}
                        <span className="opacity-55">{slot.fn}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <select
                          value={b?.refId ?? ""}
                          onChange={(e) => void setBinding(slot.id, "world", (e.target.value || undefined) as ID | undefined)}
                          className="max-w-52 rounded border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/15"
                        >
                          <option value="">绑定已有设定…</option>
                          {worldEntries.map((w) => (
                            <option key={w.id} value={w.id}>{w.title}</option>
                          ))}
                        </select>
                        <Button
                          size="sm"
                          variant="ghost"
                          isPending={draftingSlot === slot.id}
                          onPress={() => void runDraftSlot(slot.id, "world")}
                        >
                          <Layers className="size-3.5" />
                          AI 按位起草
                        </Button>
                      </div>
                      {d && d.kind === "world" && (
                        <div className="mt-2 space-y-1.5 rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.05]">
                          <input
                            value={d.name}
                            onChange={(e) => setSlotDrafts((s) => ({ ...s, [slot.id]: { ...d, name: e.target.value } }))}
                            placeholder="条目名"
                            className="w-56 rounded border border-black/10 bg-transparent px-1.5 py-0.5 dark:border-white/15"
                          />
                          <TextArea
                            rows={3}
                            value={d.body}
                            onChange={(e) => setSlotDrafts((s) => ({ ...s, [slot.id]: { ...d, body: e.target.value } }))}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" variant="primary" onPress={() => void commitSlotDraft(slot.id)}>
                              <Check className="size-3.5" />
                              确认入库并绑定
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onPress={() =>
                                setSlotDrafts((s) => {
                                  const { [slot.id]: _removed, ...rest } = s;
                                  return rest;
                                })
                              }
                            >
                              丢弃
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {(row.bookMap.causal?.length ?? 0) > 0 && (
              <div className="border-t border-black/5 pt-2">
                <p className="text-[11px] font-medium opacity-70">坑账（只作参照，不自动入库）</p>
                <ul className="mt-1 space-y-0.5">
                  {row.bookMap!.causal.map((c, i) => (
                    <li key={i} className="text-[11px] leading-relaxed opacity-70">
                      埋：{c.plant} → 收：{c.payoff}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

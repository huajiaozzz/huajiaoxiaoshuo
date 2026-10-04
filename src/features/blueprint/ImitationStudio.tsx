import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button, Card, Chip } from "@/components/kit";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, PenLine, Plus, Save, Wand2,
} from "lucide-react";
import type { BlueprintRecord, BookChapter, ChapterPlaybookEntry, ID } from "@/core";
import { findOverlaps } from "@/core";
import { imitateChapter, splitBookChapters } from "@/ai/blueprint";
import {
  createChapter, getChapterWithContent, listChapters, saveChapterContent,
} from "@/db/repo/outline";
import { useAppStore } from "@/app/store";
import { EmptyHint, SectionTitle } from "@/components/common/ui";
import { escapeHtml } from "@/utils/text";
import { formatWords } from "@/utils/format";

const NL = String.fromCharCode(10);

/**
 * 对照仿写工作台：左边原书的一章，右边这本书对应的章节。
 *
 * - 原书章节从拆解时保存的全文现切（splitBookChapters），不入库；
 * - 「AI 仿写本章」拿原章当写法参照（技法层 + 章节配方），生成作者自己故事的草稿；
 * - 草稿可编辑，保存进右侧选中的章节；每次生成后自动跑原创性自检
 *   （与原章比最长公共子串，连续 12 字以上算雷同）。
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

  // ---- 作者这本书的章节 ----
  const chapters = useLiveQuery(() => listChapters(projectId), [projectId]);
  const list = chapters ?? [];
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

  const runImitate = async () => {
    setGenerating(true);
    setGenNote(null);
    try {
      const res = await imitateChapter({
        projectId,
        technique: row.blueprint.technique,
        playbook,
        original: { title: original.title, text: original.text, words: original.words },
        target: target ? { title: target.title, summary: target.summary, goals: target.goals } : undefined,
        wordTarget: Math.max(1200, Math.min(4000, original.words)),
      });
      if (!res.ok || !res.text) {
        notify("danger", "仿写失败", res.error);
        return;
      }
      setDraft(res.text);
      setGenNote("按原书「" + original.title + "」的写法生成了草稿 —— 先看自检结果，改掉雷同再保存");
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
      <SectionTitle hint="左边原书怎么写，右边你写什么；技法照做、内容全新">对照仿写</SectionTitle>

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
        {/* 左：原书这一章 */}
        <Card className="flex min-h-0 flex-col p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-medium">{original.title}</p>
            <span className="text-[11px] opacity-50">{formatWords(original.words)}</span>
          </div>
          <div className="manuscript mt-2 max-h-[560px] min-h-72 flex-1 overflow-y-auto whitespace-pre-wrap border-t border-black/5 pt-2 text-[13px] leading-relaxed dark:border-white/10">
            {original.text}
          </div>
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
            rows={16}
            className="manuscript mt-2 min-h-72 flex-1 resize-y rounded-lg border border-black/8 bg-transparent p-3 text-[13px] leading-relaxed outline-none focus:border-black/25 dark:border-white/10 dark:focus:border-white/30"
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
    </div>
  );
}

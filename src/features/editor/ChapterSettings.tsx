import { useState } from "react";
import { Button, Input, Label, TextArea, TextField } from "@/components/kit";
import { X } from "lucide-react";
import { AnimatePresence, type Transition } from "motion/react";
import { Fade } from "@/components/animate-ui/primitives/effects/fade";
import { Zoom } from "@/components/animate-ui/primitives/effects/zoom";
import { SelectChip } from "@/components/common/ui";
import type { Chapter, ChapterStatus, ID } from "@/core";
import { CHAPTER_STATUS_LABEL } from "@/app/theme";
import { useAppStore } from "@/app/store";
import { useCharacters, useWorldEntries, useThreads } from "@/app/hooks";
import { updateChapter } from "@/db/repo/outline";

const STATUSES: ChapterStatus[] = ["idea", "outlined", "drafting", "drafted", "revising", "done", "cut"];

// 弹层动效：入场 220ms、退场 160ms。tween + 快出缓收曲线，比 spring 更"快而不跳"
const ENTER: Transition = { type: "tween", duration: 0.22, ease: [0.16, 1, 0.3, 1] };
const EXIT: Transition = { type: "tween", duration: 0.16, ease: "easeOut" };

/** 章节属性面板：目标、出场人物、地点、钩子、埋设/回收的伏笔 */
export function ChapterSettings({
  chapter,
  projectId,
  onClose,
  onSaved,
}: {
  chapter: Chapter;
  projectId: ID;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useAppStore((s) => s.notify);
  const characters = useCharacters(projectId);
  const world = useWorldEntries(projectId);
  const threads = useThreads(projectId);

  const [title, setTitle] = useState(chapter.title);
  const [summary, setSummary] = useState(chapter.summary ?? "");
  const [goals, setGoals] = useState(chapter.goals.join("\n"));
  const [hook, setHook] = useState(chapter.hook ?? "");
  const [cliffhanger, setCliffhanger] = useState(chapter.cliffhanger ?? "");
  const [storyTime, setStoryTime] = useState(chapter.storyTime ?? "");
  const [status, setStatus] = useState<ChapterStatus>(chapter.status);
  const [tension, setTension] = useState(chapter.tension);
  const [characterIds, setCharacterIds] = useState<string[]>(chapter.characterIds);
  const [locationIds, setLocationIds] = useState<string[]>(chapter.locationIds);
  const [plants, setPlants] = useState<string[]>(chapter.plantsThreadIds);
  const [pays, setPays] = useState<string[]>(chapter.paysThreadIds);
  const [saving, setSaving] = useState(false);
  // 退场后才通知父级卸载：弹层是父级 {settingsFor && ...} 条件渲染的，
  // 直接 onClose 会把整个组件瞬间拔掉，退出动画播不完
  const [closing, setClosing] = useState(false);
  const requestClose = () => setClosing(true);

  const toggle = (list: string[], setter: (v: string[]) => void, id: string) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateChapter(chapter.id, {
        title: title.trim() || chapter.title,
        summary: summary.trim() || undefined,
        goals: goals
          .split(String.fromCharCode(10))
          .map((g) => g.trim())
          .filter(Boolean),
        hook: hook.trim() || undefined,
        cliffhanger: cliffhanger.trim() || undefined,
        storyTime: storyTime.trim() || undefined,
        status,
        tension,
        characterIds,
        locationIds,
        plantsThreadIds: plants,
        paysThreadIds: pays,
      });
      onSaved();
      requestClose();
    } catch (e) {
      notify("danger", "保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // 包 AnimatePresence：closing 置 true 时先播完退场，onExitComplete 再让父级卸载。
  // primitive 的 transition 进出共用，退场更快是靠 exit 目标自带的 transition 单独定的
  return (
    // 退场期间先断开交互：淡出时弹层还挂在页面上，再点一下会把一次关闭点成两次动作
    <div className={closing ? "pointer-events-none" : ""}>
      <AnimatePresence onExitComplete={() => onClose()}>
        {!closing && (
          <Fade
            key="chapter-settings"
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={requestClose}
            transition={ENTER}
            exit={{ opacity: 0, transition: EXIT }}
          >
            <Zoom
              initialScale={0.96}
              className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
              transition={ENTER}
              exit={{ scale: 0.98, transition: EXIT }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
                <h3 className="text-sm font-semibold">章节属性</h3>
                <Button isIconOnly size="sm" variant="ghost" onPress={requestClose}>
                  <X className="size-4" />
                </Button>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <TextField value={title} onChange={setTitle}>
                  <Label>章节名</Label>
                  <Input />
                </TextField>

                <TextField value={summary} onChange={setSummary}>
                  <Label>本章梗概（会进入 AI 上下文）</Label>
                  <TextArea rows={2} placeholder="本章发生了什么，推进了什么" />
                </TextField>

                <TextField value={goals} onChange={setGoals}>
                  <Label>必须完成的推进点（每行一条）</Label>
                  <TextArea rows={3} placeholder={"主角第一次见到反派。每行一条，AI 会按这些目标来写。"} />
                </TextField>

                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField value={hook} onChange={setHook}>
                    <Label>开篇钩子</Label>
                    <Input placeholder="第一句就要抓人" />
                  </TextField>
                  <TextField value={cliffhanger} onChange={setCliffhanger}>
                    <Label>结尾悬念</Label>
                    <Input placeholder="让读者想翻下一章" />
                  </TextField>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="mb-1.5 block text-xs">状态</Label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ChapterStatus)}
                      className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {CHAPTER_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <TextField value={storyTime} onChange={setStoryTime}>
                    <Label>剧情内时间</Label>
                    <Input placeholder="第三年·春" />
                  </TextField>
                  <div>
                    <Label className="mb-1.5 block text-xs">张力 {tension}</Label>
                    <input
                      type="range"
                      min={-5}
                      max={5}
                      step={1}
                      value={tension}
                      onChange={(e) => setTension(Number(e.target.value))}
                      className="w-full accent-neutral-900"
                    />
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block text-xs">出场人物</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {characters.map((c) => (
                      <SelectChip
                        key={c.id}
                        selected={characterIds.includes(c.id)}
                        onPress={() => toggle(characterIds, setCharacterIds, c.id)}
                      >
                        {c.name}
                      </SelectChip>
                    ))}
                    {characters.length === 0 && <p className="text-xs opacity-50">还没有人物卡</p>}
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block text-xs">地点</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {world
                      .filter((w) => w.category === "geography" || w.category === "organization")
                      .map((w) => (
                        <SelectChip
                          key={w.id}
                          selected={locationIds.includes(w.id)}
                          onPress={() => toggle(locationIds, setLocationIds, w.id)}
                        >
                          {w.title}
                        </SelectChip>
                      ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="mb-2 block text-xs">本章埋下的伏笔</Label>
                    <div className="space-y-1">
                      {threads.map((t) => (
                        <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={plants.includes(t.id)}
                            onChange={() => toggle(plants, setPlants, t.id)}
                            className="accent-neutral-900"
                          />
                          <span className="truncate">{t.title}</span>
                        </label>
                      ))}
                      {threads.length === 0 && <p className="text-xs opacity-50">还没有伏笔条目</p>}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs">本章回收的伏笔</Label>
                    <div className="space-y-1">
                      {threads.map((t) => (
                        <label key={t.id} className="flex cursor-pointer items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={pays.includes(t.id)}
                            onChange={() => toggle(pays, setPays, t.id)}
                            className="accent-emerald-500"
                          />
                          <span className="truncate">{t.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/5 px-5 py-3 dark:border-white/5">
                <Button variant="ghost" onPress={requestClose}>
                  取消
                </Button>
                <Button variant="primary" isPending={saving} onPress={() => void save()}>
                  保存
                </Button>
              </div>
            </Zoom>
          </Fade>
        )}
      </AnimatePresence>
    </div>
  );
}

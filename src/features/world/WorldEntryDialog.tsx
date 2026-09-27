import { Button } from "@/components/kit";
import { X } from "lucide-react";
import { AnimatePresence, type Transition } from "motion/react";
import { Fade } from "@/components/animate-ui/primitives/effects/fade";
import { Zoom } from "@/components/animate-ui/primitives/effects/zoom";
import type { ID, WorldEntry } from "@/core";
import { EntryEditor } from "./EntryEditor";
import type { TitleIndex } from "./world-links";

// 弹层动效：入场 220ms、退场 160ms。tween + 快出缓收曲线，比 spring 更"快而不跳"
const ENTER: Transition = { type: "tween", duration: 0.22, ease: [0.16, 1, 0.3, 1] };
const EXIT: Transition = { type: "tween", duration: 0.16, ease: "easeOut" };

/**
 * 世界观条目的编辑弹窗。
 *
 * ## 为什么从右侧面板改成弹窗
 *
 * 原来编辑区是列表右边的一栏。问题是：**列表被挤窄、编辑区又太宽**。
 * 调过列宽（列表 380 / 编辑上限 680）之后仍然别扭 —— 因为只要编辑区常驻，
 * 列表就永远要让出一大块横向空间，而作者在浏览条目时并不需要编辑区。
 *
 * 改成弹窗后：**列表占满整页**，编辑时才浮出来。浏览和编辑彻底分开。
 *
 * 内容直接复用 EntryEditor（flat 模式），不复制表单 ——
 * 字段有二十来个，两份必然会改漏。
 */
export function WorldEntryDialog({
  open,
  onClose,
  projectId,
  entry,
  isNew,
  entries,
  titleIndex,
  incoming,
  outgoing,
  onSelect,
  onSaved,
  onDeleted,
  onQuickCreate,
}: {
  open: boolean;
  onClose: () => void;
  projectId: ID;
  entry?: WorldEntry;
  isNew: boolean;
  entries: WorldEntry[];
  titleIndex: TitleIndex;
  incoming: Map<ID, ID[]>;
  outgoing: Map<ID, ID[]>;
  onSelect: (id: ID) => void;
  onSaved: (id: ID) => void;
  onDeleted: () => void;
  onQuickCreate: (title: string) => Promise<void>;
}) {
  // 退场由 AnimatePresence 接管：退出渲染的是「移除前」那份子树（props 随元素一起冻结），
  // 所以关闭瞬间父级把 entry 置空，也不会让表单在淡出时闪成空白
  // 包 AnimatePresence：open 置 false 时先播完退场再卸载。
  // primitive 的 transition 进出共用，退场更快是靠 exit 目标自带的 transition 单独定的
  return (
    // 退场期间先断开交互：淡出时弹层还挂在页面上，再点一下会把一次关闭点成两次动作
    <div className={open ? "" : "pointer-events-none"}>
      <AnimatePresence>
        {open && (
          <Fade
            key="world-entry-dialog"
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onClick={onClose}
            transition={ENTER}
            exit={{ opacity: 0, transition: EXIT }}
          >
            <Zoom
              initialScale={0.96}
              className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-neutral-900"
              transition={ENTER}
              exit={{ scale: 0.98, transition: EXIT }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
                <h3 className="text-sm font-semibold">{isNew ? "新建条目" : "编辑条目"}</h3>
                <Button isIconOnly size="sm" variant="ghost" aria-label="关闭" onPress={onClose}>
                  <X className="size-4" />
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <EntryEditor
                  flat
                  projectId={projectId}
                  entry={entry}
                  isNew={isNew}
                  entries={entries}
                  titleIndex={titleIndex}
                  incoming={incoming}
                  outgoing={outgoing}
                  onSelect={onSelect}
                  onSaved={(id) => {
                    onSaved(id);
                    onClose();
                  }}
                  onDeleted={() => {
                    onDeleted();
                    onClose();
                  }}
                  onQuickCreate={onQuickCreate}
                />
              </div>
            </Zoom>
          </Fade>
        )}
      </AnimatePresence>
    </div>
  );
}

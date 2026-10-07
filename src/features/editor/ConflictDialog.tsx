import { useMemo } from "react";
import { Button, Modal } from "@/components/kit";
import { AlertTriangle, ArrowDownToLine, CopyCheck, Save } from "lucide-react";
import { countWords } from "@/utils/text";
import {
  assessConflict, resolveConflict, summarizeDiff, toDiffLines,
  type ConflictPair, type ResolveChoice,
} from "./conflict";

/**
 * 编辑冲突对比弹窗。
 *
 * ## 为什么不自动合并
 *
 * 实测过"自动合并"的两种朴素做法，都会在真实场景里丢内容：
 *  - 按行取并集：两个标签页各自删掉了同一段的不同位置时，行数对不上；
 *  - 保留我的、另一版存快照：作者根本不记得有这个快照，等于静默丢失。
 *
 * 冲突意味着**同一个地方被两个人改成了不同的样子**，这正是必须由人决定的事。
 * 所以这里只做一件事：把两份正文并排摊开，让人一眼看清差在哪，然后选一个。
 *
 * 但也不是每次都弹 —— 见 `assessConflict`：内容相同、或只是尾部追加时
 * 会自动处理，静默合并。打扰作者是有成本的。
 */
export function ConflictDialog({
  pair,
  chapterTitle,
  onResolve,
  onClose,
}: {
  pair: ConflictPair;
  chapterTitle: string;
  onResolve: (choice: ResolveChoice, text: string) => void;
  onClose: () => void;
}) {
  const assessment = useMemo(() => assessConflict(pair), [pair]);
  const lines = useMemo(() => toDiffLines(assessment.ops), [assessment.ops]);
  const summary = useMemo(() => summarizeDiff(assessment.ops), [assessment.ops]);
  const mineWords = countWords(pair.mineText);
  const dbWords = countWords(pair.dbText);

  const severityHint =
    assessment.severity === 'append-only'
      ? '两版内容不同，但其中一版是在另一版基础上接着往后写的，不存在互相覆盖。'
      : '同一处内容被改成了不同的样子。需要你决定保留哪一版。';

  return (
    /*
      Modal（根）必须包在最外层：它提供 Radix 的 Dialog context，
      里面的 Modal.Dialog 才拿得到（少这一层会抛
      "useContext must be used within DialogContext"，**整页白屏**）。
      本组件由父级条件渲染，所以恒为打开；onOpenChange 只用于点遮罩 / 按 Esc 时关掉。
    */
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="outside">
          <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-warning" />
              保存冲突：{chapterTitle}
            </Modal.Heading>
          </Modal.Header>
          <Modal.Body className="space-y-4">
            <p className="text-sm text-muted-foreground">
              这个章节在另一个标签页（或另一个窗口）里被改过了。库里现在是第 {pair.dbRev} 版，
              你手上是第 {pair.mineRev} 版 —— {severityHint}
            </p>

            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                <strong className="text-foreground">我的版本</strong>
                <span className="ml-2 text-muted-foreground">{mineWords} 字</span>
              </span>
              <span>
                <strong className="text-foreground">库里版本</strong>
                <span className="ml-2 text-muted-foreground">{dbWords} 字</span>
              </span>
              {summary.added > 0 && (
                <span className="text-success">库里多 {summary.added} 字</span>
              )}
              {summary.removed > 0 && (
                <span className="text-warning">我的版本多 {summary.removed} 字</span>
              )}
            </div>

            <div>
              <div className="mb-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-sm bg-success/40" />
                  仅库里有
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-sm bg-destructive/30" />
                  仅我的里有
                </span>
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-sm leading-relaxed">
                {lines.length === 0 ? (
                  <p className="text-muted-foreground">两份正文内容一致。</p>
                ) : (
                  lines.map((l, i) => (
                    <p
                      key={i}
                      className={
                        l.type === 'insert'
                          ? 'rounded bg-success/20 px-1'
                          : l.type === 'delete'
                            ? 'rounded bg-destructive/20 px-1'
                            : ''
                      }
                    >
                      {l.text || '\u00a0'}
                    </p>
                  ))
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              无论选哪一版，被放弃的那一版都会先存成快照，之后可以在「快照」里找回 —— 不会真的丢掉。
            </p>
          </Modal.Body>
          <Modal.Footer className="flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose}>
              稍后处理
            </Button>
            <Button variant="secondary" onClick={() => onResolve("save-both", resolveConflict(pair, "save-both").text)}>
              <CopyCheck className="size-4" />
              两版都保留
            </Button>
            <Button variant="secondary" onClick={() => onResolve("take-db", pair.dbText)}>
              <ArrowDownToLine className="size-4" />
              用库里那版
            </Button>
            <Button onClick={() => onResolve("keep-mine", pair.mineText)}>
              <Save className="size-4" />
              保留我的
            </Button>
          </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
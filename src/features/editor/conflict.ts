/**
 * 多标签页编辑冲突的**判定与合并策略**（纯函数，不碰数据库与编辑器）。
 *
 * ## 为什么需要它
 *
 * `saveChapterContent` 早就支持 `expectedRev` 乐观锁，但**调用方从来没传过** ——
 * 自动保存是无条件覆盖写入的。于是同一个作品在两个标签页里各写各的：
 * 后保存的那个悄悄把前一个的内容覆盖掉，作者毫不知情，切换标签页才发现"我的字没了"。
 *
 * 这类 bug 不会报错、类型也对、构建也过，只有真实双开标签页才会暴露。
 *
 * ## 为什么不放在 EditorPage 里
 *
 * 冲突判定要能被离线回归直接调用（不需要开浏览器、不需要真数据）。
 * 纯函数放在这里，`scripts/verify-conflict-ui.mjs` 用 Vite 的 ssrLoadModule 直接跑。
 */

import { diffWords, type DiffOp } from '@/utils/diff';

/** 一次冲突的完整快照：两份正文 + 各自的版本号，用于对比与决策 */
export interface ConflictPair {
  /** 本地库里那一版（别的标签页写进来的） */
  dbHtml: string;
  dbText: string;
  dbRev: number;
  /** 当前编辑器里这一版（作者正在写的） */
  mineHtml: string;
  mineText: string;
  /** 编辑器装载时看到的版本号 */
  mineRev: number;
}

/** 冲突的严重程度，决定弹窗的措辞与默认按钮 */
export type ConflictSeverity =
  /** 两边改的是同一处：必须人工选 */
  | 'divergent'
  /** 一边删了、另一边只在尾部追加：可以放心合并 */
  | 'append-only'
  /** 内容其实一样，只是版本号对不上：直接采纳即可，不必打扰作者 */
  | 'benign';

export interface ConflictAssessment {
  severity: ConflictSeverity;
  /** 逐字差异（mine → db 视角：insert 是库里多出来的，delete 是我多出来的） */
  ops: DiffOp[];
  /** 我独有的段落数（粗略：正文行） */
  mineOnlyLines: number;
  /** 库里独有的段落数 */
  dbOnlyLines: number;
  /** 是否**无需人工介入**：内容等价或只是尾部追加 */
  autoResolvable: boolean;
}

function lines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * 判断两份正文是什么关系。
 *
 * 关键设计：**大多数"冲突"其实不需要打扰作者**。
 * 真正危险的只有"同一处被改成了不同的样子"（divergent）。
 * 如果只是我在尾部追加、或者只是版本号漂移而内容一样，
 * 弹窗反而是噪音 —— 作者正忙着写，突然弹一个框只会让人以为是故障。
 */
export function assessConflict(pair: ConflictPair): ConflictAssessment {
  const { dbText, mineText } = pair;

  // 1) 内容完全一致：版本号对不上而已（可能是另一个标签页保存了同样内容）。
  //    这时直接采纳库里那份即可，绝不能弹窗。
  if (dbText === mineText) {
    return {
      severity: 'benign',
      ops: [],
      mineOnlyLines: 0,
      dbOnlyLines: 0,
      autoResolvable: true,
    };
  }

  const ops = diffWords(mineText, dbText);
  const mineLines = lines(mineText);
  const dbLines = lines(dbText);

  // 统计"只出现在一边"的段落：用来区分「整段重写」与「尾部追加」
  const setMine = new Set(mineLines);
  const setDb = new Set(dbLines);
  const mineOnly = mineLines.filter((l) => !setDb.has(l)).length;
  const dbOnly = dbLines.filter((l) => !setMine.has(l)).length;

  // 2) 只有一侧有独有段落，且那一侧是"更长的一方" → 尾部追加
  //    判据：把共有段落保序抽出来，剩下的连续追加在末尾。
  if (mineOnly === 0 || dbOnly === 0) {
    // 有独有内容的一侧是"在对方基础上只加不改」
    const onlySide = mineOnly > 0 ? 'mine' : 'db';
    const base = onlySide === 'mine' ? dbLines : mineLines;
    const extra = onlySide === 'mine' ? mineLines : dbLines;
    if (isAppendOnly(base, extra)) {
      return {
        severity: 'append-only',
        ops,
        mineOnlyLines: mineOnly,
        dbOnlyLines: dbOnly,
        autoResolvable: true,
      };
    }
  }

  // 3) 其余都是同处改写，必须人工选
  return {
    severity: 'divergent',
    ops,
    mineOnlyLines: mineOnly,
    dbOnlyLines: dbOnly,
    autoResolvable: false,
  };
}

/**
 * extra 是否只是 base 的尾部追加？
 *
 * 判据：**extra 的前 base.length 行必须与 base 逐行相等**，剩下的就是纯追加。
 *
 * ## 为什么用"逐行相等"而不是"集合包含"（第一版就栽在这里）
 *
 * 第一版把前缀长度算成了 `extra.length - base.length`（追加的段数），
 * 于是拿"追加的段"去和 base 配对：base 有两行、追加一行时，
 * 前缀只取到 1 行，第二行永远配不上 → 真实的尾部追加被判成分歧。
 *
 * 数字看着像那么回事，其实比较的是两个不同长度的集合。
 *
 * ## 为什么坚持逐行相等而不是"集合相等"
 *
 * 逐行相等是**保守**的：万一它把某个真追加误判成分歧，结果只是多弹一次窗让作者确认，
 * 而不会自动合并掉内容。**宁可多问，不可错合** —— 这条贯穿整个冲突处理。
 */
function isAppendOnly(base: string[], extra: string[]): boolean {
  if (extra.length <= base.length) return false;
  for (let i = 0; i < base.length; i++) {
    if (extra[i] !== base[i]) return false;
  }
  return true;
}

export type ResolveChoice = 'keep-mine' | 'take-db' | 'save-both';

/** 应用作者的选择，返回要落库的正文（纯文本） */
export function resolveConflict(
  pair: ConflictPair,
  choice: ResolveChoice,
): { text: string; keepSnapshotOf: 'mine' | 'db' | null } {
  switch (choice) {
    case 'keep-mine':
      return { text: pair.mineText, keepSnapshotOf: 'db' };
    case 'take-db':
      return { text: pair.dbText, keepSnapshotOf: 'mine' };
    case 'save-both':
      return { text: pair.mineText + '\n\n' + pair.dbText, keepSnapshotOf: 'db' };
  }
}

/** 把 diff 结果按段落聚合成可渲染的行，UI 直接用 */
export interface DiffLine {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/**
 * 逐字 diff → 逐行展示。
 *
 * 为什么不让 UI 直接渲染 DiffOp：词级 diff 的片段很碎（中文按字切），
 * 一屏几百个 span 没人看得下去。按行聚合后，一行一个判断点。
 * 片段内的字级标记仍然保留在 line.fragments 里，需要时能展开到字。
 */
export function toDiffLines(ops: DiffOp[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (const op of ops) {
    const parts = op.text.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) out.push({ type: 'equal', text: '' }); // 换行边界
      if (!part) return;
      const last = out[out.length - 1];
      if (last && last.type === op.type) last.text += part;
      else out.push({ type: op.type, text: part });
    });
  }
  // 清掉所有空行占位
  return out.filter((l, i) => l.text.length > 0 || (i > 0 && out[i - 1].text.length > 0));
}

/** diff 的规模描述，用于弹窗标题：「3 处新增 / 1 处删除」 */
export function summarizeDiff(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === 'insert') added += op.text.replace(/\s/g, '').length;
    if (op.type === 'delete') removed += op.text.replace(/\s/g, '').length;
  }
  return { added, removed };
}
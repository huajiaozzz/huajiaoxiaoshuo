/**
 * 回归：多标签页编辑冲突的**判定**（纯函数），+ 审稿报告生成（Markdown + DOCX）。
 *
 * 为什么不都放浏览器 e2e：这两处的核心都是纯函数 —— 冲突分类与报告排版。
 * 用 Vite 的 ssrLoadModule 直接跑真实源码，能离线复跑、毫秒级、不受机器负载影响。
 * UI 层（弹窗长什么样、按钮点下去有没有反应）由 verify-app-boots 与
 * verify-editor-save 覆盖，不在这里重复。
 */
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule('/' + p);

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  \u2713 ' + name);
  } else {
    fail += 1;
    console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : ''));
  }
};

const conflict = await load('src/features/editor/conflict.ts');
const report = await load('src/features/data/review-report.ts');

// ==================== 一、冲突判定 ====================
console.log('');
console.log('【冲突判定】');

const P = (o) => ({
  dbHtml: o.db ?? '', dbText: o.db ?? '', dbRev: o.dbRev ?? 2,
  mineHtml: o.mine ?? '', mineText: o.mine ?? '', mineRev: o.mineRev ?? 1,
});

// 1) 内容一致，只是版本号漂移 → 必须自动采纳，绝不能弹窗打扰作者
{
  const a = conflict.assessConflict(P({ db: '青云山下，雪停了。', mine: '青云山下，雪停了。' }));
  check('内容相同 → benign 且可自动处理', a.severity === 'benign' && a.autoResolvable === true, a.severity);
  check('内容相同 → ops 为空（无 diff 可显示）', a.ops.length === 0);
}

// 2) 同一处被改成不同样子 → 必须人工决定
{
  const a = conflict.assessConflict(P({ db: '青云山下，雪停了。', mine: '青云山下，雨停了。' }));
  check('同一处改写 → divergent 且需人工', a.severity === 'divergent' && a.autoResolvable === false, a.severity);
}

// 3) 尾部追加：库里那版是在我的基础上往后写的 → 可以自动合并
{
  const a = conflict.assessConflict(P({
    mine: '第一段。\n第二段。',
    db: '第一段。\n第二段。\n第三段。',
  }));
  check('尾部追加 → append-only', a.severity === 'append-only' && a.autoResolvable === true, a.severity);
}

// 4) 中间插入（不是尾部追加）→ 视为分歧，要人工决定
{
  const a = conflict.assessConflict(P({
    mine: '第一段。\n第三段。',
    db: '第一段。\n第二段。\n第三段。',
  }));
  check('中间插入 → 不算追加，需人工', a.severity === 'divergent', a.severity);
}

// 5) 整段重写 → 分歧
{
  const a = conflict.assessConflict(P({ mine: '完全不同的开头。\n完全不同的结尾。', db: '青云山。\n沈砚。' }));
  check('整段重写 → divergent', a.severity === 'divergent', a.severity);
}

// 6) 追加判定不能被重复段落骗过（这正是 isAppendOnly 反向匹配要防的）
{
  const a = conflict.assessConflict(P({
    mine: '重复段。\n重复段。',
    db: '重复段。\n别的东西。\n重复段。',
  }));
  check('重复段落不误判为追加', a.severity === 'divergent', a.severity);
}

// 7) diff 规模统计
{
  const s = conflict.summarizeDiff([{ type: 'insert', text: '新增三个字' }, { type: 'delete', text: '删' }]);
  check('diff 规模统计（插入 5 / 删除 1）', s.added === 5 && s.removed === 1, JSON.stringify(s));
}

// 8) 三种选择都返回确定结果，且"保留我的"必须先备份库里那版
{
  const pair = P({ mine: '我的版本。', db: '库里版本。' });
  const keep = conflict.resolveConflict(pair, 'keep-mine');
  const take = conflict.resolveConflict(pair, 'take-db');
  const both = conflict.resolveConflict(pair, 'save-both');
  check('保留我的 → 用我的正文', keep.text === '我的版本。', keep.text);
  check('保留我的 → 库里那版被存快照（不丢内容）', keep.keepSnapshotOf === 'db', String(keep.keepSnapshotOf));
  check('用库里那版 → 我的被存快照', take.text === '库里版本。' && take.keepSnapshotOf === 'mine');
  check('两版都保留 → 拼接且都不丢', both.text.includes('我的版本。') && both.text.includes('库里版本。'), both.text);
}

// 9) diff 行聚合：空片段不该产生空白行
{
  const lines = conflict.toDiffLines([{ type: 'equal', text: '相同' }, { type: 'delete', text: '旧' }, { type: 'insert', text: '新' }]);
  check('diff 行聚合正确', lines.length === 3, JSON.stringify(lines));
  check('diff 行保留类型', lines[1].type === 'delete' && lines[2].type === 'insert');
}

// ==================== 二、审稿报告 ====================
console.log('');
console.log('【审稿报告】');

const now = new Date();
const iso = () => now.toISOString();

const project = {
  id: 'prj_1', title: '雾港纪事', author: '测试作者',
  logline: '', synopsis: '', genres: [], tags: [], themes: [], forbidden: [],
  pov: 'third-limited', tense: 'past', targetWords: 100000, targetChapterWords: 3000,
  lengthClass: 'novel', status: 'drafting', language: 'zh-CN',
  stats: { words: 0, chapters: 0, scenes: 0, writingDays: 0 },
  createdAt: iso(), updatedAt: iso(),
};

const CH1 = '雨下了整夜。\n沈砚掀开白布的时候，死者张了张嘴。\n「你来了。」他说。';
const CH2 = '档案室的灯坏了。\n他在十二年前的卷宗里看到相同的伤口。';

const chapters = [
  { id: 'c1', projectId: 'prj_1', arcId: 'a1', title: '第一章 第三具尸体', summary: '', goals: [],
    characterIds: [], locationIds: [], status: 'drafted', wordCount: 30, tension: 0,
    plantsThreadIds: [], paysThreadIds: [], beats: [], tags: [], order: 0, createdAt: iso(), updatedAt: iso() },
  { id: 'c2', projectId: 'prj_1', arcId: 'a1', title: '第二章 旧档案', summary: '', goals: [],
    characterIds: [], locationIds: [], status: 'drafted', wordCount: 25, tension: 0,
    plantsThreadIds: [], paysThreadIds: [], beats: [], tags: [], order: 1, createdAt: iso(), updatedAt: iso() },
];

const comments = [
  { id: 'cm1', projectId: 'prj_1', chapterId: 'c1', author: '李编辑', body: '这里开场太慢，建议直接从掀白布切入。',
    anchor: { from: 5, to: 13, quote: '沈砚掀开白布的时候' }, replies: [], resolved: false,
    kind: 'note', createdAt: iso(), updatedAt: iso() },
  { id: 'cm2', projectId: 'prj_1', chapterId: 'c1', author: 'AI', body: '结尾缺少钩子。',
    anchor: { from: 5, to: 13, quote: '这句原文已经被删掉了' }, replies: [
      { id: 'r1', author: '作者', body: '会改', createdAt: iso() },
    ], resolved: false, kind: 'checklist', checklistLabel: '结尾留了悬念', createdAt: iso(), updatedAt: iso() },
  { id: 'cm3', projectId: 'prj_1', chapterId: 'c2', author: '李编辑', body: '这条已经处理完了。',
    replies: [], resolved: true, kind: 'issue', createdAt: iso(), updatedAt: iso() },
];

const suggestions = [
  { id: 's1', projectId: 'prj_1', chapterId: 'c1', kind: 'replace', proposed: '雨停了整整一夜。',
    anchor: { from: 0, to: 6, quote: '雨下了整夜' }, reason: '更简洁', author: '李编辑',
    status: 'pending', source: 'human', createdAt: iso(), updatedAt: iso() },
  { id: 's2', projectId: 'prj_1', chapterId: 'c1', kind: 'delete', proposed: '',
    anchor: { from: 14, to: 24, quote: '死者张了张嘴' }, reason: '多余', author: 'AI',
    status: 'accepted', source: 'ai', createdAt: iso(), updatedAt: iso() },
];

const chapterHtml = { c1: CH1, c2: CH2 };

const built = await report.exportReviewReport({ project, chapters, comments, suggestions, chapterHtml });
const m = built.model;

check('统计：批注总数', m.stats.totalComments === 3, String(m.stats.totalComments));
check('统计：待处理批注', m.stats.openComments === 2, String(m.stats.openComments));
check('统计：已解决批注', m.stats.resolvedComments === 1, String(m.stats.resolvedComments));
check('统计：锚点失效被单独计出', m.stats.detached === 1, String(m.stats.detached));
check('统计：待处理建议', m.stats.pendingSuggestions === 1, String(m.stats.pendingSuggestions));
check('统计：已接受建议', m.stats.acceptedSuggestions === 1, String(m.stats.acceptedSuggestions));

check('批注按章节顺序排列', m.chapters[0].chapterNo === 1 && m.chapters[2].chapterNo === 2,
  m.chapters.map((e) => e.chapterNo).join(','));
check('有效锚点能重新定位并给出上下文',
  m.chapters[0].anchored === true && Boolean(m.chapters[0].context),
  JSON.stringify(m.chapters[0]));
check('失效锚点被标记且不伪造上下文',
  m.chapters[1].anchored === false && m.chapters[1].context === undefined);
check('审稿清单标签被带进类型描述',
  m.chapters[1].kindLabel.includes('审稿清单') && m.chapters[1].kindLabel.includes('结尾留了悬念'),
  m.chapters[1].kindLabel);
check('讨论回复被保留', m.chapters[1].replies.length === 1 && m.chapters[1].replies[0].author === '作者');
check('无锚点的批注也能进报告（不丢条目）', m.chapters[2].quote === '' && m.chapters[2].body.includes('处理完了'));

// ---- Markdown ----
const md = built.markdown;
check('Markdown 含标题', md.startsWith('# 审稿报告 · 雾港纪事'));
check('Markdown 含每个批注正文', comments.every((c) => md.includes(c.body)));
check('Markdown 含锚定原文', md.includes('沈砚掀开白布的时候'));
check('Markdown 对失效锚点给出显式说明', md.includes('锚点已失效'));
check('Markdown 含建议的替换文本', md.includes('雨停了整整一夜。'));
check('Markdown 含统计概览', md.includes('批注 3 条'));
check('Markdown 对失效锚点有顶部警告', md.includes('定位不到'));
check('Markdown 结构含两个主章节', md.includes('## 一、批注') && md.includes('## 二、修订建议'));

// Markdown 里的正文不能把 ** 当强调符吃掉：批注正文含 * 时应被转义
{
  const star = [{ ...comments[0], body: '这里用了 **星号** 与 _下划线_' }];
  const b2 = report.buildReportMarkdown(report.buildReport({
    project, chapters, comments: star, suggestions: [], chapterTexts: { c1: CH1, c2: CH2 }, now,
  }));
  check('Markdown 转义 * 与 _（不破坏原文）', b2.includes('\\*\\*星号\\*\\*') && b2.includes('\\_下划线\\_'),
    b2.slice(0, 400));
}

// 空数据也要能导出，不能抛异常
{
  const empty = report.buildReportMarkdown(report.buildReport({
    project, chapters, comments: [], suggestions: [], chapterTexts: {}, now,
  }));
  check('空报告可导出且有占位说明', empty.includes('（暂无批注）') && empty.includes('（暂无修订建议）'));
}

// ---- DOCX ----
mkdirSync('/tmp/nf-review-report', { recursive: true });
writeFileSync('/tmp/nf-review-report/report.docx', Buffer.from(await built.docx.arrayBuffer()));

const checker = new URL('./fixtures/verify-review-report.py', import.meta.url).pathname;
const out = execFileSync('python3', [checker], { encoding: 'utf8' });
const d = JSON.parse(out.slice(out.indexOf('{')));
const docText = d.text || '';

check('DOCX 包无损坏条目', d.testzip === null, String(d.testzip));
check('DOCX 必需部件齐全', d.required_present === true);
check('DOCX 所有 XML 良构', Array.isArray(d.xml_errors) && d.xml_errors.length === 0, JSON.stringify(d.xml_errors));
check('DOCX 内容类型覆盖主要部件',
  (d.overrides || []).includes('/word/document.xml') && (d.overrides || []).includes('/word/styles.xml'));
check('DOCX 有段落', d.paragraph_count > 10, String(d.paragraph_count));
check('DOCX 含书名与作者元数据',
  (d.dc_title || '').includes('雾港纪事') && (d.dc_creator || '').includes('测试作者'),
  d.dc_title + ' / ' + d.dc_creator);
check('DOCX 正文含批注内容', comments.every((c) => docText.includes(c.body.slice(0, 8))),
  docText.slice(0, 200));
check('DOCX 正文含锚定原文（引文可见）', docText.includes('沈砚掀开白布的时候'));
check('DOCX 正文含替换建议', docText.includes('雨停了整整一夜。'));
check('DOCX 含引用块左边框样式', d.has_quote_border === true);
check('DOCX 与 Markdown 条目数一致（同一次取数）',
  (docText.match(/原文：/g) || []).length >= 3, String((docText.match(/原文：/g) || []).length));

// 正文含 < & 等字符时 XML 必须被转义（否则文件损坏）
{
  const nasty = [{ ...comments[0], body: '5 < 6 & "引号" \'单引号\' 都出现' }];
  const b3 = await report.exportReviewReport({
    project, chapters, comments: nasty, suggestions: [], chapterHtml,
  });
  writeFileSync('/tmp/nf-review-report/report.docx', Buffer.from(await b3.docx.arrayBuffer()));
  const raw2 = execFileSync('python3', [checker], { encoding: 'utf8' });
  const out2 = JSON.parse(raw2.slice(raw2.indexOf('{')));
  check('含 < & " 的正文不破坏 XML', Array.isArray(out2.xml_errors) && out2.xml_errors.length === 0,
    JSON.stringify(out2.xml_errors));
  check('含 < & " 的正文原样保留（转义后仍能读回）', (out2.text || '').includes('5 < 6 &'),
    (out2.text || '').slice(0, 200));
}

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);
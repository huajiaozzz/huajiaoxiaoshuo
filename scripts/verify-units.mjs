/**
 * 单元测试：锚点定位、文风分析、记忆冲突判定。
 *
 * ## 为什么是这三个模块
 *
 * ROADMAP 里「单元测试固化」写的是"JSON 修复、预算裁剪、diff、导出"，
 * 但那四项**其实早就覆盖了**：
 *   - JSON 修复 / 预算裁剪 / diff → verify-utils.mjs（【JSON 容错解析】等分组）
 *   - 导出 → verify-zip.mjs + verify-ebook.mjs
 * 真正没有单测的是下面三个，它们的共同点是**用户直接感知、且逻辑调过阈值**：
 *
 * 1. `anchor.ts` —— 批注与修订建议都锚在它上面。它漂了，所有审稿标记都会错位。
 *    审稿报告的"锚点已失效"判定也直接依赖它。
 * 2. `style-analyzer.ts` —— 离线体检的零 token 承诺全靠它（AI 味 / 错别字 / 标点）。
 * 3. `memory-conflict.ts` —— 阈值（0.75）是实测出来的，且踩过"相似≠冲突"的坑。
 *
 * 用 Vite 的 ssrLoadModule 跑真实源码：离线、毫秒级、不受机器负载影响。
 */
import { createServer } from 'vite';

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

const anchor = await load('src/utils/anchor.ts');
const style = await load('src/utils/style-analyzer.ts');
const conflict = await load('src/core/memory-conflict.ts');

// ==================== 一、锚点定位 ====================
console.log('');
console.log('【锚点定位】');

const TEXT = '他推开门。屋里有三个人：一个在写信，一个在烧纸，还有一个什么也没做。';

{
  // 1) 原偏移仍然有效 → 最快最准的一条路
  const a = { from: 0, to: 4, quote: '他推开门' };
  const r = anchor.locateAnchor(TEXT, a);
  check('原偏移命中', Boolean(r) && r.from === 0 && r.via === 'exact-offset', JSON.stringify(r));
}
{
  // 2) 偏移漂移但引文唯一 → 仍能找回
  const r = anchor.locateAnchor(TEXT, { from: 999, to: 1003, quote: '屋里有三个人' });
  check('偏移失效后按引文找回', Boolean(r) && r.from === 5 && r.via === 'unique-quote', JSON.stringify(r));
}
{
  // 3) 引文重复 → 必须靠上下文消歧，否则会标到错的位置
  const dup = '他走了。她也走了。';
  const r = anchor.locateAnchor(dup, { from: 0, to: 3, quote: '走了', prefix: '他也', suffix: '。她也' });
  check('重复引文用上下文消歧', Boolean(r) && r.from === 1, JSON.stringify(r));
}
{
  // 4) 标点/空白变了 → 模糊匹配兜底
  const messy = '他推开门，屋里有三个人';
  const r = anchor.locateAnchor(messy, { from: 0, to: 4, quote: '他推开门屋里有三个人' });
  check('标点变化后模糊匹配兜底', Boolean(r) && r.via === 'fuzzy', JSON.stringify(r));
}
{
  // 5) 真的不存在 → 返回 null（调用方据此标"已失效"），绝不能瞎猜一个位置
  const r = anchor.locateAnchor(TEXT, { from: 0, to: 5, quote: '完全不存在的一段文字' });
  check('引文不存在时返回 null 而不是错位', r === null, JSON.stringify(r));
}
{
  // 6) 空输入的边界
  check('空文本 / 空引文不抛异常',
    anchor.locateAnchor('', { from: 0, to: 2, quote: 'abc' }) === null &&
    anchor.locateAnchor(TEXT, { from: 0, to: 0, quote: '' }) === null);
}

{
  // 7) makeAnchor → locateAnchor 往返一致
  const a = anchor.makeAnchor(TEXT, 5, 11, 5);
  const r = anchor.locateAnchor(TEXT, a);
  check('makeAnchor 与 locateAnchor 往返一致',
    Boolean(r) && r.from === 5 && r.to === 11, JSON.stringify({ a, r }));
}
{
  // 8) 文本在**前面**被插入一大段后，原锚点仍应通过上下文找回
  const shifted = '（新增的一大段前置内容，大约二十个字左右。）' + TEXT;
  const a = anchor.makeAnchor(TEXT, 5, 11, 5);
  const r = anchor.locateAnchor(shifted, a);
  check('前面插入内容后锚点仍能重定位',
    Boolean(r) && shifted.slice(r.from, r.to) === a.quote, JSON.stringify(r));
}

console.log('【修订建议应用】');
{
  /*
    从后往前应用：这是 applySuggestions 的全部意义所在。
    注意偏移量要自己数准 —— 'AAAA。BBBB。CCCC。' 里 'CCCC' 在 [10,14)，
    而不是从「。CCCC」开始算（第一版写成 9..13，把句号也吃进去了，
    结果是 'AAAA改。BBBBCCCC改C。'）。测试写错偏移会伪装成被测代码有 bug。
  */
  const base = 'AAAA。BBBB。CCCC。';
  check("基准偏移自检：'CCCC' 位于 [10,14)", base.slice(10, 14) === 'CCCC', base.slice(10, 14));
  const out = anchor.applySuggestions(base, [
    { kind: 'replace', from: 10, to: 14, proposed: 'CCCC改' },
    { kind: 'replace', from: 0, to: 4, proposed: 'AAAA改' },
  ]);
  check('多条建议都正确应用（从后往前）', out === 'AAAA改。BBBB。CCCC改。', out);
}
{
  // 顺序打乱也必须得到同样结果 —— 输入顺序不该影响输出
  const base = 'AAAA。BBBB。CCCC。';
  const a = { kind: 'replace', from: 10, to: 14, proposed: 'CCCC改' };
  const b = { kind: 'replace', from: 0, to: 4, proposed: 'AAAA改' };
  check('应用结果与传入顺序无关',
    anchor.applySuggestions(base, [a, b]) === anchor.applySuggestions(base, [b, a]));
}
{
  const base = '甲乙丙丁。';
  check('delete 删掉整段',
    anchor.applySuggestions(base, [{ kind: 'delete', from: 0, to: 4, proposed: '' }]) === '。');
  check('insert 插入新段',
    anchor.applySuggestions(base, [{ kind: 'insert', from: 0, to: 0, proposed: '开头。' }]) === '开头。甲乙丙丁。');
}
{
  // 越界偏移不能抛异常也不能吞掉后面的内容
  const base = '甲乙丙丁。';
  const out = anchor.applySuggestions(base, [{ kind: 'replace', from: 900, to: 999, proposed: 'X' }]);
  check('越界偏移不抛异常', typeof out === 'string', JSON.stringify(out));
}
{
  check('deltaAfterApply：替换 = 插入-删除',
    anchor.deltaAfterApply('replace', 10, 4) === -6);
  check('deltaAfterApply：插入 = +插入长度',
    anchor.deltaAfterApply('insert', 0, 7) === 7);
}

// ==================== 二、文风分析 ====================
console.log('');
console.log('【文风分析】');

const PARA = '沈砚推开门。屋里很冷，他没有开灯。\n' +
  '窗外的雨还在下，他站在原地很久。\n' +
  '「你来了。」\n' +
  '他走过去，看见桌上放着一封信。';

{
  // 字段名要照 StyleMetrics 的真实定义写，别凭印象猜
  const m = style.analyzeStyle(PARA);
  check('analyzeStyle 返回数值指标',
    typeof m.avgSentenceLength === 'number' && typeof m.avgParagraphLength === 'number' &&
    typeof m.ttr === 'number' && typeof m.pacingScore === 'number',
    JSON.stringify(Object.keys(m)));
}
{
  // 对话占比：这段里有一句「」，dialogueRatio 应大于 0
  const m = style.analyzeStyle(PARA);
  check('对话占比被统计出来', m.dialogueRatio > 0, String(m.dialogueRatio));
}
{
  const top = style.topWords(PARA, 5);
  check('topWords 限制条数并带词频', top.length <= 5 && top.every((w) => typeof w.count === 'number'),
    JSON.stringify(top.slice(0, 3)));
}
{
  // AI 味检测：这段刻意塞了几个典型 AI 腔调词
  const aiText = '首先，我们需要深入探讨这个问题的本质。其次，值得注意的是，' +
    '这个方案在某种意义上具有重要意义。总而言之，我们应该继续保持。';
  const hits = style.detectAiSmell(aiText);
  check('AI 味检测能命中套话', hits.length > 0, JSON.stringify(hits.slice(0, 2)));
}
{
  // 干净的正文不该被误判成 AI 味 —— 误报比漏报更烦人
  const clean = '雨下了整夜。天亮时他才发现自己一直站在门口，手里那把伞早就不见了。';
  const hits = style.detectAiSmell(clean);
  check('干净正文不被误报 AI 味', hits.length === 0, JSON.stringify(hits));
}
{
  // COMMON_TYPOS 是**中文**易错词表（成语误写、语义重复这类），
  // 不是中英混用的拼写检查 —— 拿 recieve 去试它当然一条都不报。
  const typos = style.detectTypos('他按耐不住，迫不急待，一如继往的走了。');
  check('错别字检测命中成语误写', typos.length >= 3, JSON.stringify(typos.map((t) => t.wrong)));
  check('错别字给出正确写法', typos.some((t) => t.right === '按捺不住'), JSON.stringify(typos[0]));
  check('错别字带位置（便于高亮）', typos.every((t) => typeof t.index === 'number' && t.index >= 0));
}
{
  // 干净正文不该被误报 —— 误报比漏报更烦人
  const clean = '他终于走进屋里，把伞靠在门边。';
  check('干净正文不误报错别字', style.detectTypos(clean).length === 0,
    JSON.stringify(style.detectTypos(clean)));
}
{
  // 省略号写成三个半角句点
  const p1 = style.punctuationCheck('他等了很久...门才开。');
  check('检出半角省略号', p1.some((x) => x.kind.includes('省略号')), JSON.stringify(p1));
}
{
  // 破折号写成两个连字符
  const p2 = style.punctuationCheck('他愣住了--然后笑了。');
  check('检出半角破折号', p2.some((x) => x.kind.includes('破折号')), JSON.stringify(p2));
}
{
  // 半角逗号/句点：阈值是 >2，少数几个不算问题（正文里偶尔出现很正常）
  const few = style.punctuationCheck('这是半角逗号,后面跟了中文。');
  check('少量半角标点不误报', !few.some((x) => x.kind.includes('半角')), JSON.stringify(few));
  const many = style.punctuationCheck('很多半角,逗号,还有,句点.和,更多,半角,标点.');
  check('大量半角标点被报出', many.some((x) => x.kind.includes('半角')), JSON.stringify(many));
}
{
  // 连续感叹号
  const p3 = style.punctuationCheck('他大喊了一声！！！');
  check('检出连续感叹号', p3.some((x) => x.kind.includes('连续')), JSON.stringify(p3));
}
{
  const hist = style.histogram([1, 2, 3, 40, 41], [0, 10, 20, 50]);
  check('histogram 按给定分桶计数', hist.length === 4 && hist.reduce((a, b) => a + b, 0) === 5,
    JSON.stringify(hist));
}
{
  const prompt = style.stylePrompt(style.analyzeStyle(PARA), style.topWords(PARA, 5));
  check('stylePrompt 产出可用文本', typeof prompt === 'string' && prompt.length > 0);
}

// ==================== 三、记忆冲突判定 ====================
console.log('');
console.log('【记忆冲突判定】');

{
  // GOTCHAS 记录的原始坑：同义句被误报成冲突
  const a = { id: 'm1', kind: 'preference', text: '对话不要用解释性台词', projectId: 'p', pinned: false,
    paused: false, confidence: 1, evidence: [], createdAt: '', updatedAt: '' };
  const b = { ...a, id: 'm2', text: '对话不要用说明性台词' };
  const c = conflict.detectMemoryConflict(a, b);
  check('同义句（解释性/说明性）不算冲突', c === null, JSON.stringify(c));
}
{
  // 真正的冲突：同一维度两极
  const a = { id: 'm1', kind: 'preference', text: '文风要冷硬克制', projectId: 'p', pinned: false,
    paused: false, confidence: 1, evidence: [], createdAt: '', updatedAt: '' };
  const b = { ...a, id: 'm2', text: '文风要温暖细腻' };
  const c = conflict.detectMemoryConflict(a, b);
  check('同一维度两极判为冲突', Boolean(c), JSON.stringify(c));
}
{
  // GOTCHAS 记录的第二个坑：轴词被否定时要翻到对面
  const a = { id: 'm1', kind: 'preference', text: '文风要冷硬，不要抒情', projectId: 'p', pinned: false,
    paused: false, confidence: 1, evidence: [], createdAt: '', updatedAt: '' };
  const b = { ...a, id: 'm2', text: '文风要冷硬' };
  check('否定式表述与正面表述一致而非矛盾', conflict.detectMemoryConflict(a, b) === null,
    JSON.stringify(conflict.detectMemoryConflict(a, b)));
}
{
  // GOTCHAS 实测数字：相似度阈值 0.75 的依据
  const s = conflict.textSimilarity('对话不要用解释性台词', '对话不要用说明性台词');
  check('改一字的相似度约 0.8（高于 0.75 阈值）', s >= 0.75 && s < 0.95, String(s.toFixed(3)));
  const far = conflict.textSimilarity('对话不要用解释性台词', '这一章要加快节奏，删掉冗余描写');
  check('无关文本相似度很低（与 0.75 有安全区）', far < 0.4, String(far.toFixed(3)));
}
{
  check('normalizeMemoryText 去标点空白',
    conflict.normalizeMemoryText('你好，世界！') === conflict.normalizeMemoryText('你好世界'));
  check('完全相同的文本相似度为 1',
    conflict.textSimilarity('文风要冷硬', '文风要冷硬') === 1);
  check('空文本相似度为 0 且不抛异常',
    conflict.textSimilarity('', '') === 0);
}
{
  // 整批里两两比对
  const mk = (id, text) => ({ id, kind: 'preference', text, projectId: 'p', pinned: false,
    paused: false, confidence: 1, evidence: [], createdAt: '', updatedAt: '' });
  const facts = [
    mk('f1', '文风要冷硬克制'),
    mk('f2', '文风要温暖细腻'),
    mk('f3', '对话不要用解释性台词'),
    mk('f4', '对话不要用说明性台词'),
  ];
  const conflicts = conflict.findMemoryConflicts(facts);
  check('批量判定只报出真正的那一对', conflicts.length === 1, JSON.stringify(conflicts));
  const dupes = conflict.findNearDuplicates(facts);
  check('批量近重复能找出同义句对', dupes.length >= 1, JSON.stringify(dupes));
}

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);
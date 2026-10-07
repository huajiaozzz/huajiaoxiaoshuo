/**
 * 审稿报告生成器：把项目级的批注与修订建议导出成一份可发给编辑/作者的报告。
 *
 * ## 为什么要导出
 *
 * 批注与建议存在本地 IndexedDB 里，作者自己看没问题，但"编辑通读全书给意见"这个场景里，
 * 报告要**发给对方**。原来的做法只能是截图或复制粘贴 —— 锚点上下文、章节位置、作者是谁
 * 全部丢失，对方看到一句"这里太拖沓"却不知道说的是哪一段。
 *
 * 报告要解决的就是这个：每一条都带上**章节号、锚定原文、上下文**，让对方不打开应用也能定位。
 *
 * ## 为什么 Markdown 与 DOCX 各写一份而不是只写一份
 *
 * - Markdown：作者要能改、能对比版本、能进 git。纯文本生成，零格式风险。
 * - DOCX：编辑那边只会用 Word 打开。
 *
 * 两者共用同一份 `ReportModel`（下面的 buildReport），所以不会出现
 * "Markdown 里有 12 条、DOCX 里只有 11 条"这种对不上的情况。
 */

import type { Chapter, ChapterComment, ID, Project, ReviewSuggestion } from '@/core';
import { escapeXml } from './ebook';
import { createZip } from './zip';
import { locateAnchor } from '@/utils/anchor';
import { docToText } from '@/utils/rich-text';

// ==================== 报告数据模型 ====================

export interface ReportEntry {
  /** 章节顺序（从 0 开始），报告里显示为「第 N 章」 */
  chapterNo: number;
  chapterTitle: string;
  /** 锚定的原文片段 */
  quote: string;
  /** 锚点前后的上下文，让对方知道说的是哪一段 */
  context?: string;
  /** 锚点在当前正文里还找不找得到 */
  anchored: boolean;
  body: string;
  author: string;
  createdAt: string;
  replies?: { author: string; body: string; createdAt: string }[];
  resolved: boolean;
  kindLabel: string;
}

export interface ReportSuggestionEntry {
  chapterNo: number;
  chapterTitle: string;
  kind: 'replace' | 'delete' | 'insert';
  kindLabel: string;
  quote: string;
  proposed: string;
  reason?: string;
  author: string;
  sourceLabel: string;
  status: 'pending' | 'accepted' | 'rejected';
  statusLabel: string;
  createdAt: string;
}

export interface ReportModel {
  projectTitle: string;
  author?: string;
  /** 生成时间（ISO） */
  generatedAt: string;
  chapters: ReportEntry[];
  suggestions: ReportSuggestionEntry[];
  stats: {
    totalComments: number;
    openComments: number;
    resolvedComments: number;
    pendingSuggestions: number;
    acceptedSuggestions: number;
    rejectedSuggestions: number;
    /** 锚点已经漂移、报告里引不到原文的条数 */
    detached: number;
  };
}

const KIND_LABEL: Record<ChapterComment['kind'], string> = {
  note: '批注',
  checklist: '审稿清单',
  issue: '问题定位',
};

const SUGGESTION_KIND_LABEL: Record<ReviewSuggestion['kind'], string> = {
  replace: '替换',
  delete: '删除',
  insert: '插入',
};

const STATUS_LABEL: Record<ReviewSuggestion['status'], string> = {
  pending: '待处理',
  accepted: '已接受',
  rejected: '已拒绝',
};

/** 取锚点前后各 40 字，让报告里能看出这句话在段落中的位置 */
function anchorContext(text: string, from: number, to: number): string | undefined {
  const pad = 40;
  const start = Math.max(0, from - pad);
  const end = Math.min(text.length, to + pad);
  const slice = text.slice(start, end);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return (prefix + slice + suffix).trim() || undefined;
}

/**
 * 组装报告数据模型。**纯函数**，不读数据库 —— 调用方把数据取好传进来。
 * 这样离线回归可以喂假数据断言输出，不依赖 IndexedDB。
 */
export function buildReport(input: {
  project: Project;
  chapters: Chapter[];
  comments: ChapterComment[];
  suggestions: ReviewSuggestion[];
  /** 正文纯文本：chapterId → text。用它给锚点重新定位。 */
  chapterTexts: Record<ID, string>;
  now?: Date;
}): ReportModel {
  const { project, chapters, comments, suggestions, chapterTexts } = input;
  const now = input.now ?? new Date();

  const orderOf = new Map(chapters.map((c, i) => [c.id, i]));
  const titleOf = new Map(chapters.map((c) => [c.id, c.title]));
  const noOf = (id: ID) => orderOf.get(id);
  const title = (id: ID) => titleOf.get(id) ?? '（已删除的章节）';

  const chapterEntries: ReportEntry[] = [];
  let detached = 0;

  // 先按章节顺序、再按正文位置排序，读起来才是"从头读到尾"的顺序
  const sortedComments = [...comments].sort((a, b) => {
    const ca = noOf(a.chapterId) ?? 9999;
    const cb = noOf(b.chapterId) ?? 9999;
    if (ca !== cb) return ca - cb;
    return (a.anchor?.from ?? 0) - (b.anchor?.from ?? 0);
  });

  for (const c of sortedComments) {
    const chapterNo = noOf(c.chapterId);
    const text = chapterTexts[c.chapterId] ?? '';
    // 锚点重新定位：正文改过之后偏移会漂移，以 quote 为准（见 core/review.ts 的设计取舍）
    const hit = c.anchor ? locateAnchor(text, c.anchor) : undefined;
    const anchored = Boolean(hit);
    if (c.anchor && !hit) detached += 1;
    chapterEntries.push({
      chapterNo: chapterNo === undefined ? 9999 : chapterNo + 1,
      chapterTitle: title(c.chapterId),
      quote: c.anchor?.quote ?? '',
      context: hit ? anchorContext(text, hit.from, hit.to) : undefined,
      anchored,
      body: c.body,
      author: c.author,
      createdAt: c.createdAt,
      replies: c.replies.map((r) => ({ author: r.author, body: r.body, createdAt: r.createdAt })),
      resolved: c.resolved,
      kindLabel: KIND_LABEL[c.kind] + (c.checklistLabel ? ' · ' + c.checklistLabel : ''),
    });
  }

  const sortedSuggestions = [...suggestions].sort((a, b) => {
    const ca = noOf(a.chapterId) ?? 9999;
    const cb = noOf(b.chapterId) ?? 9999;
    if (ca !== cb) return ca - cb;
    return a.anchor.from - b.anchor.from;
  });

  const suggestionEntries: ReportSuggestionEntry[] = sortedSuggestions.map((s) => {
    const chapterNo = noOf(s.chapterId);
    return {
      chapterNo: chapterNo === undefined ? 9999 : chapterNo + 1,
      chapterTitle: title(s.chapterId),
      kind: s.kind,
      kindLabel: SUGGESTION_KIND_LABEL[s.kind],
      quote: s.anchor.quote,
      proposed: s.proposed,
      reason: s.reason,
      author: s.author,
      sourceLabel: s.source === 'ai' ? 'AI 生成' : '人工',
      status: s.status,
      statusLabel: STATUS_LABEL[s.status],
      createdAt: s.createdAt,
    };
  });

  return {
    projectTitle: project.title,
    author: project.author,
    generatedAt: now.toISOString(),
    chapters: chapterEntries,
    suggestions: suggestionEntries,
    stats: {
      totalComments: comments.length,
      openComments: comments.filter((c) => !c.resolved).length,
      resolvedComments: comments.filter((c) => c.resolved).length,
      pendingSuggestions: suggestions.filter((s) => s.status === 'pending').length,
      acceptedSuggestions: suggestions.filter((s) => s.status === 'accepted').length,
      rejectedSuggestions: suggestions.filter((s) => s.status === 'rejected').length,
      detached,
    },
  };
}

// ==================== Markdown ====================

function mdEscape(s: string): string {
  // 引号文本里可能含 Markdown 语法。只挡会破坏结构的几类，不做过度转义。
  return s.replace(/([*_`[\]|])/g, '\\$1');
}

function mdDate(iso: string): string {
  return iso.replace('T', ' ').slice(0, 16);
}

/** 生成 Markdown 报告 */
export function buildReportMarkdown(m: ReportModel): string {
  const L: string[] = [];
  const s = m.stats;

  L.push('# 审稿报告 · ' + m.projectTitle);
  L.push('');
  if (m.author) L.push('> 作者：' + m.author);
  L.push('> 导出于 ' + mdDate(m.generatedAt));
  L.push('');
  L.push('**概览**：批注 ' + s.totalComments + ' 条（待处理 ' + s.openComments +
    '，已解决 ' + s.resolvedComments + '），修订建议 ' + (s.pendingSuggestions + s.acceptedSuggestions + s.rejectedSuggestions) +
    ' 条（待处理 ' + s.pendingSuggestions + '，已接受 ' + s.acceptedSuggestions + '，已拒绝 ' + s.rejectedSuggestions + '）。');
  if (s.detached > 0) {
    L.push('');
    L.push('> ⚠️ 有 ' + s.detached + ' 条批注锚定的原文在当前正文里已经找不到了（正文改动较大），报告只保留了当时的引文。');
  }
  L.push('');

  // ---- 批注 ----
  L.push('## 一、批注');
  L.push('');
  if (m.chapters.length === 0) {
    L.push('（暂无批注）');
    L.push('');
  } else {
    for (const e of m.chapters) {
      L.push('### 第 ' + e.chapterNo + ' 章 · ' + e.chapterTitle);
      L.push('');
      L.push('- **类型**：' + e.kindLabel + '　**状态**：' + (e.resolved ? '已解决' : '待处理') + '　**提出者**：' + e.author + '　**时间**：' + mdDate(e.createdAt));
      if (e.quote) {
        L.push('');
        L.push('> 原文：' + mdEscape(e.quote));
        if (e.context && e.context !== e.quote) {
          L.push('>');
          L.push('> 上下文：' + mdEscape(e.context));
        }
        if (!e.anchored) L.push('>');
        if (!e.anchored) L.push('> （锚点已失效：正文改动后这段原文定位不到了）');
      }
      L.push('');
      L.push(mdEscape(e.body));
      L.push('');
      if (e.replies?.length) {
        L.push('**讨论**：');
        for (const r of e.replies) {
          L.push('- ' + r.author + '（' + mdDate(r.createdAt) + '）：' + mdEscape(r.body));
        }
        L.push('');
      }
      L.push('---');
      L.push('');
    }
  }

  // ---- 修订建议 ----
  L.push('## 二、修订建议');
  L.push('');
  if (m.suggestions.length === 0) {
    L.push('（暂无修订建议）');
    L.push('');
  } else {
    const idx = (n: number) => (n >= 9999 ? '未知章节' : '第 ' + n + ' 章');
    for (const s of m.suggestions) {
      L.push('### ' + idx(s.chapterNo) + ' · ' + s.chapterTitle);
      L.push('');
      L.push('- **操作**：' + s.kindLabel + '　**状态**：' + s.statusLabel + '　**来源**：' + s.sourceLabel + '　**提出者**：' + s.author);
      L.push('');
      L.push('> 原文：' + mdEscape(s.quote));
      if (s.kind !== 'delete' && s.proposed) {
        L.push('>');
        L.push('> 建议改为：' + mdEscape(s.proposed));
      }
      if (s.reason) {
        L.push('');
        L.push('**理由**：' + mdEscape(s.reason));
      }
      L.push('');
      L.push('---');
      L.push('');
    }
  }

  return L.join('\n');
}

// ==================== DOCX ====================

/**
 * DOCX 段落构造。与 ebook.ts 的 docxParagraph 同规格（A4 / 中文首行缩进 / 宋体），
 * 但这里需要更多块类型（引用、标签行、项目符号），所以独立实现而不复用 ——
 * 报告的段落结构和正文完全不同，硬套会把报告做成小说排版。
 */
function p(text: string, opts: { style?: string; indent?: boolean; bold?: boolean; color?: string; italic?: boolean; size?: number } = {}): string {
  const pPr =
    '<w:pPr>' +
    (opts.indent === false ? '<w:ind w:firstLineChars="0"/>' : '<w:ind w:firstLineChars="200"/>') +
    '<w:spacing w:line="320" w:lineRule="auto" w:after="100"/>' +
    (opts.style ? '<w:pStyle w:val="' + opts.style + '"/>' : '') +
    '</w:pPr>';
  const rPr =
    '<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/>' +
    (opts.bold ? '<w:b/>' : '') +
    (opts.italic ? '<w:i/>' : '') +
    (opts.color ? '<w:color w:val="' + opts.color + '"/>' : '') +
    '<w:sz w:val="' + (opts.size ?? 22) + '"/></w:rPr>';
  return '<w:p>' + pPr + '<w:r>' + rPr +
    '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>';
}

function h(text: string, level: 1 | 2 | 3): string {
  const size = level === 1 ? 34 : level === 2 ? 28 : 24;
  return (
    '<w:p><w:pPr><w:ind w:firstLineChars="0"/><w:spacing w:before="' + (level === 1 ? 400 : 280) + '" w:after="180"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="黑体" w:hAnsi="Arial"/><w:b/><w:sz w:val="' + size + '"/></w:rPr>' +
    '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>'
  );
}

/** 引用块：左缩进 + 灰字 + 竖线感（用边框实现） */
function quote(text: string, label?: string): string {
  const labelRun = label
    ? '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="黑体"/><w:b/><w:color w:val="888888"/><w:sz w:val="19"/></w:rPr>' +
      '<w:t xml:space="preserve">' + escapeXml(label) + '：</w:t></w:r>'
    : '';
  return (
    '<w:p><w:pPr><w:ind w:firstLineChars="0" w:left="420"/>' +
    '<w:pBdr><w:left w:val="single" w:sz="6" w:space="6" w:color="BBBBBB"/></w:pBdr>' +
    '<w:spacing w:after="80"/></w:pPr>' +
    labelRun +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/><w:color w:val="555555"/><w:sz w:val="21"/></w:rPr>' +
    '<w:t xml:space="preserve">' + escapeXml(text) + '</w:t></w:r></w:p>'
  );
}

function metaLine(text: string): string {
  return p(text, { indent: false, color: '777777', size: 19 });
}

function bullet(text: string): string {
  return (
    '<w:p><w:pPr><w:ind w:firstLineChars="0" w:left="360" w:hanging="180"/><w:spacing w:after="60"/></w:pPr>' +
    '<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="21"/></w:rPr>' +
    '<w:t xml:space="preserve">· ' + escapeXml(text) + '</w:t></w:r></w:p>'
  );
}

/** 生成 DOCX 报告（真 OOXML，零第三方依赖） */
export async function buildReportDocx(m: ReportModel): Promise<Blob> {
  const s = m.stats;
  const body: string[] = [];

  body.push(h('审稿报告 · ' + m.projectTitle, 1));
  if (m.author) body.push(metaLine('作者：' + m.author));
  body.push(metaLine('导出于 ' + mdDate(m.generatedAt)));
  body.push(
    p(
      '批注 ' + s.totalComments + ' 条（待处理 ' + s.openComments + '，已解决 ' + s.resolvedComments +
        '），修订建议 ' + (s.pendingSuggestions + s.acceptedSuggestions + s.rejectedSuggestions) +
        ' 条（待处理 ' + s.pendingSuggestions + '，已接受 ' + s.acceptedSuggestions + '，已拒绝 ' + s.rejectedSuggestions + '）。',
      { indent: false, bold: true },
    ),
  );
  if (s.detached > 0) {
    body.push(metaLine('注意：有 ' + s.detached + ' 条批注锚定的原文在当前正文里已定位不到，报告保留了当时的引文。'));
  }

  // ---- 批注 ----
  body.push(h('一、批注', 2));
  if (m.chapters.length === 0) {
    body.push(p('（暂无批注）'));
  } else {
    for (const e of m.chapters) {
      body.push(h('第 ' + e.chapterNo + ' 章 · ' + e.chapterTitle, 3));
      body.push(metaLine(
        e.kindLabel + '　' + (e.resolved ? '已解决' : '待处理') + '　提出者：' + e.author + '　' + mdDate(e.createdAt),
      ));
      if (e.quote) {
        body.push(quote(e.quote, '原文'));
        if (e.context && e.context !== e.quote) body.push(quote(e.context, '上下文'));
        if (!e.anchored) body.push(metaLine('（锚点已失效：正文改动后这段原文定位不到了）'));
      }
      body.push(p(e.body));
      for (const r of e.replies ?? []) {
        body.push(bullet(r.author + '（' + mdDate(r.createdAt) + '）：' + r.body));
      }
      body.push(metaLine('————————————————'));
    }
  }

  // ---- 修订建议 ----
  body.push(h('二、修订建议', 2));
  if (m.suggestions.length === 0) {
    body.push(p('（暂无修订建议）'));
  } else {
    const idx = (n: number) => (n >= 9999 ? '未知章节' : '第 ' + n + ' 章');
    for (const sg of m.suggestions) {
      body.push(h(idx(sg.chapterNo) + ' · ' + sg.chapterTitle, 3));
      body.push(metaLine(sg.kindLabel + '　' + sg.statusLabel + '　' + sg.sourceLabel + '　提出者：' + sg.author));
      body.push(quote(sg.quote, '原文'));
      if (sg.kind !== 'delete' && sg.proposed) body.push(quote(sg.proposed, '建议改为'));
      if (sg.reason) body.push(p('理由：' + sg.reason, { indent: false, italic: true, color: '666666' }));
      body.push(metaLine('————————————————'));
    }
  }

  const sectPr =
    '<w:sectPr>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
    '<w:docGrid w:linePitch="312"/>' +
    '</w:sectPr>';

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
    '</Relationships>';

  const docRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/>' +
    '<w:sz w:val="22"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '</w:styles>';

  const coreXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>' + escapeXml('审稿报告 · ' + m.projectTitle) + '</dc:title>' +
    '<dc:creator>' + escapeXml(m.author || '花椒写作平台') + '</dc:creator>' +
    '<cp:lastModifiedBy>花椒写作平台</cp:lastModifiedBy>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + m.generatedAt.replace(/\.\d+Z$/, 'Z') + '</dcterms:created>' +
    '<dcterms:modified xsi:type="dcterms:W3CDTF">' + m.generatedAt.replace(/\.\d+Z$/, 'Z') + '</dcterms:modified>' +
    '</cp:coreProperties>';

  const appXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
    '<Application>花椒写作平台</Application>' +
    '<Comments>' + s.totalComments + '</Comments>' +
    '</Properties>';

  return createZip([
    { path: '[Content_Types].xml', text: contentTypes },
    { path: '_rels/.rels', text: rootRels },
    { path: 'docProps/core.xml', text: coreXml },
    { path: 'docProps/app.xml', text: appXml },
    { path: 'word/document.xml', text: documentXml },
    { path: 'word/styles.xml', text: styles },
    { path: 'word/_rels/document.xml.rels', text: docRels },
  ]);
}

/**
 * 一次性把数据取齐并生成两种格式。
 *
 * 为什么要一个入口：调用方（审稿台按钮）不该关心"正文纯文本从哪来、
 * 章节顺序怎么排"。这两份报告必须来自**同一次取数**，否则可能出现
 * MD 与 DOCX 条目数对不上（取数之间用户又批注了）。
 */
export async function exportReviewReport(input: {
  project: Project;
  chapters: Chapter[];
  comments: ChapterComment[];
  suggestions: ReviewSuggestion[];
  /** 正文 HTML → 由本函数转纯文本并定位锚点 */
  chapterHtml: Record<ID, string>;
}): Promise<{ markdown: string; docx: Blob; model: ReportModel }> {
  const chapterTexts: Record<ID, string> = {};
  for (const [id, html] of Object.entries(input.chapterHtml)) {
    chapterTexts[id] = docToText(html ?? "");
  }
  const model = buildReport({
    project: input.project,
    chapters: input.chapters,
    comments: input.comments,
    suggestions: input.suggestions,
    chapterTexts,
  });
  const markdown = buildReportMarkdown(model);
  const docx = await buildReportDocx(model);
  return { markdown, docx, model };
}
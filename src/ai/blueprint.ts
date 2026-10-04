import type { BookChapter, ChapterPlaybookEntry, ID, NovelTemplate, StoryBlueprint, TemplateCategory } from "@/core";
import { db } from "@/db/database";
import { runJson, runText, systemWithProject } from "./runner";
import { jsonInstruction } from "./prompts";
import { asArray, asNumber, asString, pickStr } from "./json";
import { countWords } from "@/utils/text";

const NL = String.fromCharCode(10);
/** 回车符。用字符码构造，避免在源码里写转义序列被工具链吃掉 */
const CR_CHAR = String.fromCharCode(13);

/**
 * 拆书：读一本参考书，提取可复用的写作技法与结构。
 *
 * 输入处理上有个现实约束：一本长篇动辄几十万字，不可能整本喂进去。
 * 做法是「开头全读 + 全文均匀取样」——开头决定视角、腔调、钩子；
 * 中后段决定节奏与结构。取样点都标出来，让模型知道自己在看片段而不是连续文本。
 */
const SAMPLE_BUDGET = 14000;
const OPENING_CHARS = 5000;

/** 从全文里取出有代表性的样本：开头连续 + 后续均匀取样 */
export function sampleText(text: string, budget = SAMPLE_BUDGET, opening = OPENING_CHARS): { text: string; sampled: boolean } {
  const clean = text.split(CR_CHAR).join(NL).trim();
  if (clean.length <= budget) return { text: clean, sampled: false };

  const head = clean.slice(0, opening);
  const rest = clean.slice(opening);
  const slots = 6;
  const perSlot = Math.floor((budget - opening) / slots);
  const step = Math.floor(rest.length / slots);
  const parts: string[] = ["【开头】" + head];
  for (let i = 0; i < slots; i++) {
    const start = i * step;
    const slice = rest.slice(start, start + perSlot);
    if (!slice.trim()) continue;
    const percent = Math.round(((opening + start) / clean.length) * 100);
    parts.push("【全文约 " + percent + "% 处】" + slice);
  }
  return { text: parts.join(NL + NL), sampled: true };
}

const TECHNIQUE_SCHEMA = [
  "{",
  '  "pov": "叙述视角与人称，以及镜头离主角多远",',
  '  "timeHandling": "时间处理：顺叙/倒叙/双线，跳转规律",',
  '  "proseStyle": "语言特征：句子长短、用词倾向、比喻密度、腔调",',
  '  "paragraphing": "段落与场景切分方式",',
  '  "informationRelease": "信息释放节奏（最重要）：什么时候给、什么时候藏",',
  '  "hooks": "开篇钩与章末钩分别怎么下",',
  '  "dialogueRatio": "对话与叙述的配比，对话承担什么功能",',
  '  "emotionalCurve": "情绪曲线：张力怎么起伏与铺垫",',
  '  "ensembleHandling": "配角与群像的处理方式",',
  '  "signatureMove": "这个作者最值得学的一招（一句话）"',
  "}",
].join(NL);

const CONTENT_SCHEMA = [
  "{",
  '  "genre": "题材与卖点",',
  '  "worldRulesShape": "有哪几类规则在起作用（不要记具体设定）",',
  '  "relationshipShape": "人物关系的拓扑结构（谁对立谁、谁欠谁，不要记人名）",',
  '  "plotEngine": "推动故事向前的核心机器是什么",',
  '  "actStructure": [ { "act": "第一幕", "function": "这一幕在做什么" } ],',
  '  "turningPoints": ["转折点的功能，不记具体事件"],',
  '  "endingType": "结局类型",',
  '  "readerExperience": "目标读者与阅读体验",',
  '  "chapterTemplate": [ { "role": "章节角色，如铺垫/升级/回收", "function": "这一章承担什么功能", "tension": 3 } ]',
  "}",
].join(NL);

export interface AnalyzeOptions {
  projectId: ID;
  sourceText: string;
  sourceTitle?: string;
  signal?: AbortSignal;
}

export interface AnalyzeResult {
  ok: boolean;
  blueprint?: StoryBlueprint;
  error?: string;
  model: string;
  sampled: boolean;
  sampleWords: number;
}

/** 拆书：产出技法层 + 内容层 */
export async function analyzeBlueprint(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const clean = opts.sourceText.split(CR_CHAR).join(NL).trim();
  if (countWords(clean) < 500) {
    return { ok: false, error: "样本太短（不足 500 字），拆不出结构。建议至少给一章正文或一份完整大纲。", model: "", sampled: false, sampleWords: 0 };
  }

  const { text: sample, sampled } = sampleText(clean);
  const sampleWords = countWords(clean);

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是资深小说编辑，擅长把一本小说拆成可复用的写作技法。",
      "你的读者是写作者，他要学的是『这本书为什么好看』，不是『这本书讲了什么』。",
      "技法描述必须具体到能指导写作，例如『每章结尾抛一个新疑问，答案隔两章才给』，",
      "而不是『节奏紧凑』这种空话。",
      "分析情节结构时只描述功能（这一幕在做什么、这个转折改变了什么），不要复述具体事件。",
    ].join(NL),
  );

  const user = [
    "### 待拆解的参考文本",
    opts.sourceTitle ? "（来源标注：" + opts.sourceTitle + "）" : "",
    sampled ? "以下是节选：开头连续，之后按全文百分比均匀取样。" : "以下是全文。",
    "",
    sample,
    "",
    "### 任务",
    "把这本书拆成两部分。",
    "",
    "第一部分【技法层】：它怎么写出来的 —— 视角、时间处理、语言、段落、",
    "信息释放节奏、钩子、对话配比、情绪曲线、群像处理，以及这个作者最值得学的一招。",
    "",
    "第二部分【内容层】：它讲了什么类型的 story —— 题材、世界规则的种类、",
    "人物关系的拓扑、情节引擎、几幕结构、转折点的功能、结局类型、读者体验。",
    "**内容层只描述结构与功能，不要复述具体情节、不要写具体人名。**",
    "",
    "另外给出一个「章节功能模板」：这类书的一章通常承担什么功能，按顺序列 4~8 条。",
  ].join(NL);

  const res = await runJson<Record<string, unknown>>({
    taskKind: "blueprint",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction("{" + NL + '  "technique": ' + TECHNIQUE_SCHEMA + "," + NL + '  "content": ' + CONTENT_SCHEMA + NL + "}"),
    context: { projectId: opts.projectId, sections: ["profile"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, error: res.error ?? "模型输出不是合法 JSON", model: res.model, sampled, sampleWords };
  }

  const data = res.parsed.data as Record<string, unknown>;
  const t = (data.technique as Record<string, unknown>) ?? {};
  const c = (data.content as Record<string, unknown>) ?? {};

  const str = (o: Record<string, unknown>, k: string) => pickStr(o, k) || "（模型未给出）";

  const blueprint: StoryBlueprint = {
    technique: {
      pov: str(t, "pov"),
      timeHandling: str(t, "timeHandling"),
      proseStyle: str(t, "proseStyle"),
      paragraphing: str(t, "paragraphing"),
      informationRelease: str(t, "informationRelease"),
      hooks: str(t, "hooks"),
      dialogueRatio: str(t, "dialogueRatio"),
      emotionalCurve: str(t, "emotionalCurve"),
      ensembleHandling: str(t, "ensembleHandling"),
      signatureMove: str(t, "signatureMove"),
    },
    content: {
      genre: str(c, "genre"),
      worldRulesShape: str(c, "worldRulesShape"),
      relationshipShape: str(c, "relationshipShape"),
      plotEngine: str(c, "plotEngine"),
      actStructure: asArray<Record<string, unknown>>(c.actStructure)
        .map((a) => ({ act: pickStr(a, "act") || "一幕", function: pickStr(a, "function") }))
        .filter((a) => a.function)
        .slice(0, 8),
      turningPoints: asArray<unknown>(c.turningPoints).map((x) => asString(x)).filter(Boolean).slice(0, 12),
      endingType: str(c, "endingType"),
      readerExperience: str(c, "readerExperience"),
    },
    chapterTemplate: asArray<Record<string, unknown>>(c.chapterTemplate ?? data.chapterTemplate)
      .map((r) => ({
        role: pickStr(r, "role") || "章节",
        function: pickStr(r, "function"),
        tension: Math.max(1, Math.min(5, Math.round(asNumber(r.tension, 3)))),
      }))
      .filter((r) => r.function)
      .slice(0, 10),
    model: res.model,
    analyzedAt: new Date().toISOString(),
    sampleWords,
  };

  return { ok: true, blueprint, model: res.model, sampled, sampleWords };
}

/* ------------------------------------------------------------------ */
/* 按蓝图生成新作                                                      */
/* ------------------------------------------------------------------ */

export interface GenerateFromBlueprintOptions {
  projectId: ID;
  blueprint: StoryBlueprint;
  /** 作者的新点子 —— 这才是故事的来源 */
  premise: string;
  chapterCount?: number;
  wordsPerChapter?: number;
  signal?: AbortSignal;
}

export interface GeneratedStory {
  title: string;
  logline: string;
  premise: string;
  characters: { name: string; role: string; tagline?: string; want?: string; flaw?: string }[];
  world: { title: string; category: string; body: string; importance: number }[];
  rules: { title: string; statement: string; severity: string }[];
  arcs: { title: string; summary?: string; goal?: string; conflict?: string; outcome?: string }[];
  chapters: { title: string; summary?: string; tension?: number; hook?: string }[];
}

export interface GenerateFromBlueprintResult {
  ok: boolean;
  story?: GeneratedStory;
  error?: string;
  model: string;
}

const STORY_SCHEMA = [
  "{",
  '  "title": "书名（全新，不得与参考书相似）",',
  '  "logline": "一句话故事（25字内，要有钩子）",',
  '  "premise": "核心高概念（150字内）",',
  '  "characters": [ { "name": "全新中文姓名", "role": "protagonist|antagonist|deuteragonist|mentor|foil|love-interest|sidekick|minor", "tagline": "一句话定位", "want": "表层欲望", "flaw": "致命缺陷" } ],',
  '  "world": [ { "title": "全新条目名", "category": "geography|history|politics|magic|technology|religion|economy|species|culture|organization|item|language|custom", "body": "具体内容", "importance": 3 } ],',
  '  "rules": [ { "title": "规则名", "statement": "不可违反的硬规则", "severity": "error|warn|info" } ],',
  '  "arcs": [ { "title": "卷名", "summary": "本卷写什么", "goal": "主角目标", "conflict": "核心冲突", "outcome": "结束状态" } ],',
  '  "chapters": [ { "title": "章节标题", "summary": "本章发生什么", "tension": 3, "hook": "章末留下的问题" } ]',
  "}",
].join(NL);

/**
 * 按蓝图生成新作。
 *
 * 关键约束写在提示词里并反复强调：
 *  - 技法层全部照用（那是学来的手艺）
 *  - 内容层全部重做（人物、世界、事件、名字都不许沿用）
 *  - 不许出现参考书里的任何成句表述
 *
 * 生成完还会跑一次原创性自检（在 UI 层做，因为需要参考书原文）。
 */
export async function generateFromBlueprint(opts: GenerateFromBlueprintOptions): Promise<GenerateFromBlueprintResult> {
  const project = await db.projects.get(opts.projectId);
  const t = opts.blueprint.technique;
  const c = opts.blueprint.content;
  const chapters = Math.max(3, Math.min(60, opts.chapterCount ?? 12));
  const perChapter = Math.max(800, Math.min(6000, opts.wordsPerChapter ?? 2500));

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是顶级故事策划。这次的任务是：用一套已经拆解好的写作技法，写一个**全新的故事**。",
      "必须严格遵守：",
      "1. 技法层（视角、节奏、信息释放、钩子、语言处理）要完全照做 —— 那是要学的手艺。",
      "2. 内容层必须全部重做：人物、姓名、世界设定、专有名词、具体事件，一个都不能沿用。",
      "3. 不得出现参考书里的任何成句表述；也不要把参考书的情节换个名字重写一遍。",
      "4. 故事的血肉来自作者给的新点子，技法只是组织方式。",
      "如果发现自己在复述参考书的情节，立刻换一个完全不同的走向。",
    ].join(NL),
  );

  const user = [
    "### 作者的创作点子（故事的来源）",
    opts.premise,
    "",
    "### 要照做的技法（来自参考书拆解）",
    "视角：" + t.pov,
    "时间处理：" + t.timeHandling,
    "语言：" + t.proseStyle,
    "段落与场景：" + t.paragraphing,
    "**信息释放节奏：" + t.informationRelease + "**",
    "钩子：" + t.hooks,
    "对话配比：" + t.dialogueRatio,
    "情绪曲线：" + t.emotionalCurve,
    "群像处理：" + t.ensembleHandling,
    "最值得学的一招：" + t.signatureMove,
    "",
    "### 结构参照（只借用骨架，不借用血肉）",
    "幕结构：" + (c.actStructure.map((a) => a.act + "=" + a.function).join("；") || "（无）"),
    "转折点功能：" + (c.turningPoints.join("；") || "（无）"),
    "情节引擎类型：" + c.plotEngine,
    "人物关系拓扑：" + c.relationshipShape,
    "结局类型：" + c.endingType,
    "",
    "### 章节功能模板（新作的每一章要承担类似功能，但内容全新）",
    opts.blueprint.chapterTemplate.map((r2, i) => i + 1 + ". [" + r2.role + "] " + r2.function + "（张力 " + r2.tension + "）").join(NL) || "（无）",
    "",
    "### 输出要求",
    "基于作者的点子，设计一个完整的新故事：",
    "- 3~7 位人物（含反派），姓名全新且与参考书无关",
    "- 6~12 条世界观条目，全部重新设计",
    "- 3~6 条世界硬规则",
    "- 分卷结构",
    "- " + chapters + " 章章节大纲，每章约 " + perChapter + " 字，章末都要留钩子",
    "",
    project ? "（本书标题可参考：" + project.title + "，但请以新设计为准）" : "",
  ].filter(Boolean).join(NL);

  const res = await runJson<Record<string, unknown>>({
    taskKind: "imitate",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction(STORY_SCHEMA),
    context: { projectId: opts.projectId, sections: ["profile"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.parsed?.ok) {
    return { ok: false, error: res.error ?? "模型输出不是合法 JSON", model: res.model };
  }

  const d = res.parsed.data as Record<string, unknown>;
  const story: GeneratedStory = {
    title: pickStr(d, "title") || "未命名",
    logline: pickStr(d, "logline"),
    premise: pickStr(d, "premise"),
    characters: asArray<Record<string, unknown>>(d.characters).map((r2) => ({
      name: pickStr(r2, "name"),
      role: pickStr(r2, "role") || "minor",
      tagline: pickStr(r2, "tagline") || undefined,
      want: pickStr(r2, "want") || undefined,
      flaw: pickStr(r2, "flaw") || undefined,
    })).filter((x) => x.name),
    world: asArray<Record<string, unknown>>(d.world).map((r2) => ({
      title: pickStr(r2, "title"),
      category: pickStr(r2, "category") || "custom",
      body: pickStr(r2, "body"),
      importance: Math.max(1, Math.min(5, Math.round(asNumber(r2.importance, 3)))),
    })).filter((x) => x.title && x.body),
    rules: asArray<Record<string, unknown>>(d.rules).map((r2) => ({
      title: pickStr(r2, "title"),
      statement: pickStr(r2, "statement"),
      severity: pickStr(r2, "severity") || "warn",
    })).filter((x) => x.title && x.statement),
    arcs: asArray<Record<string, unknown>>(d.arcs).map((r2) => ({
      title: pickStr(r2, "title"),
      summary: pickStr(r2, "summary") || undefined,
      goal: pickStr(r2, "goal") || undefined,
      conflict: pickStr(r2, "conflict") || undefined,
      outcome: pickStr(r2, "outcome") || undefined,
    })).filter((x) => x.title),
    chapters: asArray<Record<string, unknown>>(d.chapters).map((r2) => ({
      title: pickStr(r2, "title"),
      summary: pickStr(r2, "summary") || undefined,
      tension: Math.max(1, Math.min(5, Math.round(asNumber(r2.tension, 3)))),
      hook: pickStr(r2, "hook") || undefined,
    })).filter((x) => x.title),
  };

  return { ok: true, story, model: res.model };
}

/* ------------------------------------------------------------------ */
/* 整本拆解 → 模板入库 + 逐章对照仿写                                   */
/* ------------------------------------------------------------------ */

/**
 * 把整本文本切成章节。优先按真实章节标题（第X章/楔子/Chapter N…），
 * 识别不到至少 3 个标题就按 ~3500 字在段落边界兜底切段（fromHeading=false）。
 * 不入库 —— 每次从原文现切，避免同一份全文存两份。
 */
const CHAPTER_HEADING_RE =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节]|楔子|序章|引子|序言|番外[一二三四五六七八九十\d]*|Chapter\s+\d+).{0,40}$/;

export function splitBookChapters(text: string): { chapters: BookChapter[]; byHeading: boolean } {
  const clean = text.split(CR_CHAR).join(NL).trim();
  if (!clean) return { chapters: [], byHeading: false };
  const lines = clean.split(NL);

  const headingIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    // 标题行要短：整段正文偶然以「第」开头不该被当成标题
    if (t && t.length <= 40 && CHAPTER_HEADING_RE.test(t)) headingIdx.push(i);
  }

  if (headingIdx.length >= 3) {
    const chapters: BookChapter[] = [];
    // 第一个标题之前若还有实质内容（前言/简介），并进第一章，不丢内容
    const pre = lines.slice(0, headingIdx[0]).join(NL).trim();
    for (let k = 0; k < headingIdx.length; k++) {
      const start = headingIdx[k] + 1;
      const end = k + 1 < headingIdx.length ? headingIdx[k + 1] : lines.length;
      let body = lines.slice(start, end).join(NL).trim();
      if (k === 0 && pre) body = pre + NL + NL + body;
      if (countWords(body) === 0) continue;
      chapters.push({ title: lines[headingIdx[k]].trim(), text: body, words: countWords(body), fromHeading: true });
    }
    if (chapters.length >= 3) return { chapters, byHeading: true };
  }

  // 兜底切段：按段落累积到 ~3500 字
  const paras = clean.split(/\n+/);
  const chunks: BookChapter[] = [];
  let buf: string[] = [];
  let bufWords = 0;
  const flush = () => {
    if (!buf.length) return;
    const text2 = buf.join(NL).trim();
    if (countWords(text2) > 0) {
      chunks.push({ title: "片段 " + (chunks.length + 1), text: text2, words: countWords(text2), fromHeading: false });
    }
    buf = [];
    bufWords = 0;
  };
  for (const p of paras) {
    buf.push(p);
    bufWords += countWords(p);
    if (bufWords >= 3500) flush();
  }
  flush();
  return { chapters: chunks, byHeading: false };
}

/** 单章样本：开头多读（结构感在中前段），结尾留钩子样本 */
function chapterSample(text: string, budget = 2800): string {
  const t = text.trim();
  if (t.length <= budget) return t;
  const head = Math.floor(budget * 0.65);
  return t.slice(0, head) + NL + "【中略】" + NL + t.slice(-Math.floor(budget * 0.35));
}

const PLAYBOOK_SCHEMA = [
  "{",
  '  "chapters": [ { "index": 0, "role": "这一章在全书里的功能角色，如开局钩子/升级/回收", "function": "这一章做了什么（只说写法功能，不复述情节）", "beats": ["按推进顺序的场景节拍，3~6 条，每条一句"], "tension": 3, "hook": "章末钩是怎么下的" } ],',
  '  "digest": "80~120 字的技法速览：这本书的写法精髓（给作者一眼看懂）",',
  '  "template": {',
  '    "name": "模板名，10 字内，风格化如「XX·XX」",',
  '    "logline": "这类书的一句话卖点（25 字内，不剧透具体情节）",',
  '    "synopsis": "给新建作品预填的故事骨架（120 字内，讲结构不讲细节）",',
  '    "category": "xuanhuan|urban|scifi|history|game|romance|mystery|wuxia|war|apocalypse|infinite|fantasy|horror|realism|healing",',
  '    "genres": ["1~3 个体裁标签"],',
  '    "pov": "first|second|third-limited|third-omniscient|mixed",',
  '    "lengthClass": "short|novella|novel|epic|webnovel",',
  '    "tags": ["2~4 个展示标签，如 男频·学生向 三幕式"],',
  '    "toneKeywords": ["4~8 个基调关键词"]',
  "  }",
  "}",
].join(NL);

const CATEGORY_VALUES = new Set([
  "xuanhuan", "urban", "scifi", "history", "game", "romance", "mystery",
  "wuxia", "war", "apocalypse", "infinite", "fantasy", "horror", "realism", "healing",
]);
const POV_VALUES = new Set(["first", "second", "third-limited", "third-omniscient", "mixed"]);
const LENGTH_VALUES = new Set(["short", "novella", "novel", "epic", "webnovel"]);

/** 从中文描述里兜底猜枚举值 —— 模型没按约定输出时用 */
function guessPov(text: string): NovelTemplate["pov"] {
  if (/第二人称/.test(text)) return "second";
  if (/多视角|双线视角|视角切换/.test(text)) return "mixed";
  if (/全知/.test(text)) return "third-omniscient";
  if (/第一人称/.test(text)) return "first";
  return "third-limited";
}

function guessLengthClass(text: string): NovelTemplate["lengthClass"] {
  if (/网文连载|连载/.test(text)) return "webnovel";
  if (/超长篇|百万字/.test(text)) return "epic";
  if (/中篇/.test(text)) return "novella";
  if (/短篇/.test(text)) return "short";
  return "novel";
}

function guessCategory(genre: string): Exclude<TemplateCategory, "all"> {
  const t = genre ?? "";
  for (const [re, cat] of [
    [/玄幻|仙侠|修真|修仙/, "xuanhuan"],
    [/科幻|末世|星际|机甲/, "scifi"],
    [/悬疑|推理|刑侦/, "mystery"],
    [/言情|现言|甜宠|古言/, "romance"],
    [/武侠/, "wuxia"],
    [/历史|架空历史/, "history"],
    [/游戏|电竞/, "game"],
    [/军事|战争/, "war"],
    [/无限流|诸天/, "infinite"],
    [/奇幻|西幻|魔法/, "fantasy"],
    [/惊悚|恐怖|怪谈/, "horror"],
    [/治愈|种田|日常/, "healing"],
    [/末世|废土/, "apocalypse"],
  ] as [RegExp, Exclude<TemplateCategory, "all">][]) {
    if (re.test(t)) return cat;
  }
  return "urban";
}

export interface BookTemplateParts {
  template: NovelTemplate;
  playbook: ChapterPlaybookEntry[];
  techniqueDigest: string;
}

export interface DeconstructBookResult {
  ok: boolean;
  /** 全书技法/结构拆解（与单章拆解同形，落 blueprints 表） */
  blueprint?: StoryBlueprint;
  /** 组装好的模板 + 章节配方 + 速览（落 userTemplates 表） */
  parts?: BookTemplateParts;
  error?: string;
  model: string;
  sampled: boolean;
  sampleWords: number;
  /** 章节切分情况（UI 展示用） */
  chapterCount: number;
  byHeading: boolean;
}

/**
 * 整本拆解：全书技法/结构分析 + 逐章配方 + 组装成可入库的模板。
 *
 * 两次模型调用：先复用 analyzeBlueprint 拆技法/内容层，再把有代表性的
 * 几章（开头两章 + 中段 + 结尾，最多 5 章）喂给第二次调用，产出章节配方、
 * 技法速览和模板的枚举字段（pov/lengthClass/category 这些没法从散文里猜准）。
 */
export async function deconstructBookTemplate(opts: AnalyzeOptions): Promise<DeconstructBookResult> {
  const { chapters, byHeading } = splitBookChapters(opts.sourceText);
  const analysis = await analyzeBlueprint(opts);
  if (!analysis.ok || !analysis.blueprint) {
    return { ok: false, error: analysis.error, model: analysis.model, sampled: analysis.sampled, sampleWords: analysis.sampleWords, chapterCount: chapters.length, byHeading };
  }
  const blueprint = analysis.blueprint;
  const sampleWords = analysis.sampleWords;
  const sampled = analysis.sampled;

  // 选代表章：真实章节才逐章拆（兜底切段没有「章」的概念）
  const playable = byHeading ? chapters.filter((c) => c.words >= 300) : [];
  const picks: number[] = [];
  if (playable.length >= 3) {
    const cand = [0, 1, Math.floor(playable.length / 3), Math.floor((playable.length * 2) / 3), playable.length - 1];
    for (const i of cand) if (!picks.includes(i) && i >= 0 && i < playable.length) picks.push(i);
    picks.sort((a, b) => a - b);
  }

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是资深小说编辑，擅长把一本书拆成别人能照着学的「章节配方」。",
      "只描述写法功能（这一章怎么推进、钩怎么下），不复述具体情节、不写具体人名。",
    ].join(NL),
  );

  const user = [
    "### 这本书的整体拆解（已由另一次分析得出）",
    "视角：" + blueprint.technique.pov,
    "信息释放：" + blueprint.technique.informationRelease,
    "钩子：" + blueprint.technique.hooks,
    "章节功能模板：" + blueprint.chapterTemplate.map((r) => r.role).join("→"),
    "",
    "### 代表性章节原文（共 " + picks.length + " 章）",
    ...picks.map((i) => "【第 " + (i + 1) + " 章 · " + playable[i].title + " · 约 " + playable[i].words + " 字】" + NL + chapterSample(playable[i].text)),
    "",
    "### 任务",
    "对上面每一章给出「章节配方」：index 用我标的编号，role/function 用写法功能描述，",
    "beats 按推进顺序列 3~6 条（每条一句话），tension 1~5，hook 说清章末钩的打法。",
    "再给 digest（全书技法速览 80~120 字）和 template（这类书的可复用模板字段，",
    "枚举值必须从我列的选项里选）。",
  ].join(NL);

  let playbook: ChapterPlaybookEntry[] = [];
  let digest = "";
  let template: NovelTemplate | null = null;
  let model = analysis.model;

  const res = await runJson<Record<string, unknown>>({
    taskKind: "blueprint",
    projectId: opts.projectId,
    system,
    user,
    jsonSchemaHint: jsonInstruction(PLAYBOOK_SCHEMA),
    context: { projectId: opts.projectId, sections: ["profile"], budget: 3000 },
    signal: opts.signal,
  });
  model = res.model || model;

  if (res.ok && res.parsed?.ok) {
    const d = res.parsed.data as Record<string, unknown>;
    const list = asArray<Record<string, unknown>>(d.chapters);
    playbook = list
      .map((row) => {
        const idx = Math.max(0, Math.min(picks.length - 1, Math.round(asNumber(row.index, 0))));
        const src = playable[picks[idx]] ?? playable[0];
        return {
          role: pickStr(row, "role") || (src ? "第 " + src.title + " 型章节" : "常规章节"),
          function: pickStr(row, "function"),
          tension: Math.max(1, Math.min(5, Math.round(asNumber(row.tension, 3)))),
          beats: asArray<unknown>(row.beats).map((b) => asString(b)).filter(Boolean).slice(0, 6),
          hook: pickStr(row, "hook") || undefined,
        };
      })
      .filter((r) => r.function && r.beats.length > 0);
    digest = pickStr(d, "digest");
    const t = (d.template as Record<string, unknown>) ?? {};
    const povRaw = pickStr(t, "pov");
    const lenRaw = pickStr(t, "lengthClass");
    const catRaw = pickStr(t, "category");
    const name = pickStr(t, "name") || (opts.sourceTitle?.trim() || "参考书") + "·仿写";
    template = {
      id: "pending",
      emoji: "📖",
      name,
      logline: pickStr(t, "logline") || blueprint.content.plotEngine,
      synopsis: pickStr(t, "synopsis") || undefined,
      category: (CATEGORY_VALUES.has(catRaw) ? catRaw : guessCategory(blueprint.content.genre)) as Exclude<TemplateCategory, "all">,
      tags: asArray<unknown>(t.tags).map((x) => asString(x)).filter(Boolean).slice(0, 4),
      genres: asArray<unknown>(t.genres).map((x) => asString(x)).filter(Boolean).slice(0, 3).length
        ? asArray<unknown>(t.genres).map((x) => asString(x)).filter(Boolean).slice(0, 3)
        : blueprint.content.genre.split(/[·/、,，\s]+/).filter(Boolean).slice(0, 3),
      lengthClass: (LENGTH_VALUES.has(lenRaw) ? lenRaw : guessLengthClass(blueprint.technique.pov + blueprint.content.readerExperience)) as NovelTemplate["lengthClass"],
      pov: (POV_VALUES.has(povRaw) ? povRaw : guessPov(blueprint.technique.pov)) as NovelTemplate["pov"],
      seed: digest || undefined,
      toneKeywords: asArray<unknown>(t.toneKeywords).map((x) => asString(x)).filter(Boolean).slice(0, 8),
    };
  }

  // 第二次调用失败也能交付：从既有拆解兜底组装，只是没有逐章 beats
  if (!template) {
    const genre = blueprint.content.genre;
    digest = [
      "视角 " + blueprint.technique.pov,
      "信息释放上" + blueprint.technique.informationRelease,
      "钩子打法：" + blueprint.technique.hooks,
      "语言上" + blueprint.technique.proseStyle + "。",
    ].join("；");
    template = {
      id: "pending",
      emoji: "📖",
      name: (opts.sourceTitle?.trim() || "参考书") + "·仿写",
      logline: blueprint.content.plotEngine,
      synopsis: undefined,
      category: guessCategory(genre),
      tags: ["拆书模板"],
      genres: genre.split(/[·/、,，\s]+/).filter(Boolean).slice(0, 3),
      lengthClass: guessLengthClass(blueprint.content.readerExperience),
      pov: guessPov(blueprint.technique.pov),
      seed: digest,
      toneKeywords: [],
    };
  }
  if (!playbook.length) {
    playbook = blueprint.chapterTemplate.map((r) => ({ role: r.role, function: r.function, tension: r.tension, beats: [r.function] }));
  }

  return {
    ok: true,
    blueprint,
    parts: { template, playbook, techniqueDigest: digest },
    model,
    sampled,
    sampleWords,
    chapterCount: chapters.length,
    byHeading,
  };
}

/* ------------------------------------------------------------------ */
/* 对照仿写：按原文章节逐章生成新稿                                     */
/* ------------------------------------------------------------------ */

export interface ImitateChapterOptions {
  projectId: ID;
  technique: StoryBlueprint["technique"];
  /** 这一章的配方（整本拆书才有；单章拆解退化为通用章节功能） */
  playbook?: ChapterPlaybookEntry;
  /** 原书这一章：只学写法，内容必须全新 */
  original: { title: string; text: string; words: number };
  /** 作者这本书里对应的目标章 */
  target?: { title?: string; summary?: string; goals?: string[] };
  /** 目标字数；默认按原章字数取中 */
  wordTarget?: number;
  signal?: AbortSignal;
}

export interface ImitateChapterResult {
  ok: boolean;
  text?: string;
  error?: string;
  model: string;
}

/**
 * 对照仿写一章：技法层照做、本章配方照做、原章原文只当写法参照。
 * 提示词里反复强调不得复用原文成句 —— 生成后 UI 层还会拿原文做原创性自检。
 */
export async function imitateChapter(opts: ImitateChapterOptions): Promise<ImitateChapterResult> {
  const t = opts.technique;
  const wordTarget = Math.max(800, Math.min(5000, opts.wordTarget ?? Math.max(1200, opts.original.words)));
  const pb = opts.playbook;

  const system = await systemWithProject(
    opts.projectId,
    [
      "你是熟练的网文/小说写手，正在按一套拆解好的技法仿写一章。",
      "必须严格遵守：",
      "1. 技法层（视角、信息释放、钩子、对话配比、语言处理）完全照做。",
      "2. 内容必须来自作者自己的故事与设定，人物、地点、事件一律不用原书的。",
      "3. 原文章节只用来学「怎么写」，绝不允许复用原书的任何成句表述或情节。",
      "4. 直接输出正文：不要章节标题、不要任何解释或前后缀。",
    ].join(NL),
  );

  const user = [
    "### 这一章的写法配方" + (pb ? "" : "（无逐章配方，按通用章节功能写）"),
    pb ? "角色：" + pb.role : "",
    pb ? "本章功能：" + pb.function : "",
    pb ? "场景节拍（按顺序推进）：" + pb.beats.map((b, i) => (i + 1) + ". " + b).join("；") : "",
    pb ? "张力等级：" + pb.tension + "/5；章末钩：" + pb.hook : "",
    "",
    "### 要照做的技法",
    "视角：" + t.pov,
    "信息释放：" + t.informationRelease,
    "钩子：" + t.hooks,
    "对话配比：" + t.dialogueRatio,
    "情绪曲线：" + t.emotionalCurve,
    "语言：" + t.proseStyle,
    "最值得学的一招：" + t.signatureMove,
    "",
    "### 原书这一章（只学写法，严禁复用内容与成句）",
    "【" + opts.original.title + " · 约 " + opts.original.words + " 字】",
    chapterSample(opts.original.text, 4500),
    "",
    "### 你的故事（本章属于这本书）",
    opts.target?.title ? "目标章题：" + opts.target.title : "",
    opts.target?.summary ? "本章大纲：" + opts.target.summary : "",
    opts.target?.goals?.length ? "本章要完成的推进点：" + opts.target.goals.join("；") : "",
    "",
    "### 输出要求",
    "写出一章完整正文，约 " + wordTarget + " 字；场景推进严格按节拍顺序；章末按下钩打法收尾。",
  ].filter(Boolean).join(NL);

  const res = await runText({
    taskKind: "imitate",
    projectId: opts.projectId,
    system,
    user,
    context: { projectId: opts.projectId, sections: ["profile"], budget: 4000 },
    signal: opts.signal,
  });

  if (!res.ok || !res.text?.trim()) {
    return { ok: false, error: res.error ?? "模型没有返回正文", model: res.model ?? "" };
  }
  return { ok: true, text: res.text.trim(), model: res.model ?? "" };
}

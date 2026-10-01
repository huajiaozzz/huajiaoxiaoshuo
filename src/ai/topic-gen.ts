import type { LengthClass, NovelTemplate, PovStyle, TemplateCategory } from "@/core";
import { TEMPLATE_CATEGORY_LABEL, lengthProfile } from "@/core";
import { newId } from "@/utils/id";
import { asArrayAny, asStringArray, pickStr } from "./json";
import { baseSystem } from "./prompts";
import { runJson } from "./runner";

const NL = String.fromCharCode(10);

const POV_TEXT: Record<PovStyle, string> = {
  first: "第一人称",
  second: "第二人称",
  "third-limited": "第三人称限知",
  "third-omniscient": "第三人称全知",
  mixed: "多视角切换",
};

const POVS: PovStyle[] = ["first", "second", "third-limited", "third-omniscient", "mixed"];
const LENGTHS: LengthClass[] = ["short", "novella", "novel", "epic", "webnovel"];

const LENGTH_TEXT: Record<LengthClass, string> = {
  short: "短篇",
  novella: "中篇",
  novel: "长篇",
  epic: "超长篇",
  webnovel: "网文连载",
};

/** 分类 → 兜底 emoji：模型没给 emoji 时按分类补一个，卡片不会出现空图标 */
const CATEGORY_EMOJI: Record<Exclude<TemplateCategory, "all">, string> = {
  xuanhuan: "🗡️",
  urban: "🏙️",
  scifi: "🚀",
  history: "🏯",
  game: "🎮",
  romance: "🌸",
  mystery: "🕯️",
  wuxia: "⚔️",
  war: "🎖️",
  apocalypse: "☢️",
  infinite: "🎲",
  fantasy: "🧙",
  horror: "🔪",
  realism: "📻",
  healing: "🍃",
};

export interface TopicGenOptions {
  /** 作者的灵感 / 关键词。留空就让模型自己出题（覆盖不同类型） */
  hint?: string;
  /** 倾向分类：只影响基调与用词，不做硬过滤 */
  category?: TemplateCategory;
  /** 作者已经填过的体裁 / 篇幅 / 视角，作为倾向带上 */
  genres?: string[];
  lengthClass?: LengthClass;
  pov?: PovStyle;
  /** 要几条（2-8） */
  count?: number;
  /** 换一批：把已经生成过的书名带上，让模型避开 */
  avoid?: string[];
  signal?: AbortSignal;
}

export interface TopicGenResult {
  ok: boolean;
  candidates: NovelTemplate[];
  error?: string;
}

/**
 * AI 生成开书选题（新建作品弹窗 → 模板区「AI 选题」）。
 *
 * 为什么不复用内置模板库：模板库是写死的 30 个套路，作者真正需要的是
 * 「围绕我这句灵感，给我几个能直接开写的方向」。这里把模型的产出归一化成
 * NovelTemplate —— 和内置模板**共用同一条预填与创建路径**，
 * 新建作品页因此不需要区分来源，AI 出的选题也能直接带进「一句话成书」。
 *
 * 注意：此时项目还没有创建，所以不带 projectId（也就不会进 AI 用量统计）。
 */
export async function generateTopics(opts: TopicGenOptions = {}): Promise<TopicGenResult> {
  const count = Math.max(2, Math.min(8, Math.round(opts.count ?? 4)));
  const hint = (opts.hint ?? "").trim();
  const category = opts.category && opts.category !== "all" ? opts.category : undefined;

  const system = [
    baseSystem(),
    "",
    "【本次任务】你在做开书选题：给作者几个能立刻开写的方向，而不是写正文。",
    "- 几条选题之间差异要大：不同的切入点、不同的核心矛盾，不要同一套路换皮。",
    "- 书名要像真的能上架，可以用「正名·副题」的结构（如「雾港旧信·验尸官手记」）；不要「XX 逆袭」「重生之 XXX」这类空壳标题。",
    "- 一句话故事必须有钩子（反常设定 / 两难处境 / 信息差），不是剧情概述。",
    "- seed 是交给下一步「一句话成书」的种子：主角是谁、能力或设定、核心冲突、第一个转折，80-160 字。",
    "- 不要复用真实存在的知名作品书名与桥段；拿不准就换一个。",
    "- 所有字段都用中文（genres / toneKeywords 也用中文词）。",
  ].join(NL);

  const lines: string[] = ["### 作者给的信息"];
  lines.push(hint ? `灵感 / 关键词：${hint}` : "灵感 / 关键词：（作者没有给，你自己出题，覆盖不同类型）");
  if (category) lines.push(`倾向分类：${TEMPLATE_CATEGORY_LABEL[category]}`);
  if (opts.genres?.length) lines.push(`体裁倾向：${opts.genres.join("、")}`);
  if (opts.lengthClass) {
    lines.push(`篇幅：${LENGTH_TEXT[opts.lengthClass]}（目标约 ${lengthProfile(opts.lengthClass).targetWords} 字）`);
  }
  if (opts.pov) lines.push(`视角倾向：${POV_TEXT[opts.pov]}`);
  if (opts.avoid?.length) lines.push(`已经生成过这些书名，这次要换一批不同的：${opts.avoid.slice(0, 8).join("、")}`);
  lines.push("");
  lines.push(`### 输出格式（只输出 JSON，不要代码块，恰好 ${count} 条）`);
  lines.push("{");
  lines.push('  "topics": [');
  lines.push("    {");
  lines.push('      "name": "书名·副题",');
  lines.push('      "emoji": "一个 emoji",');
  lines.push('      "logline": "一句话故事（≤40 字，带钩子）",');
  lines.push('      "synopsis": "2-3 句展开：主角是谁、要解决什么、阻力从哪来、走向如何",');
  lines.push('      "genres": ["体裁1", "体裁2"],');
  lines.push('      "pov": "first | second | third-limited | third-omniscient | mixed",');
  lines.push('      "lengthClass": "short | novella | novel | epic | webnovel",');
  lines.push('      "tags": ["受众", "结构或套路关键词"],');
  lines.push('      "seed": "给一句话成书的种子，80-160 字",');
  lines.push('      "toneKeywords": ["基调词", "基调词"]');
  lines.push("    }");
  lines.push("  ]");
  lines.push("}");

  const res = await runJson<Record<string, unknown>>({
    taskKind: "brainstorm",
    system,
    user: lines.join(NL),
    jsonSchemaHint:
      '{"topics":[{"name":"","emoji":"","logline":"","synopsis":"","genres":[],"pov":"","lengthClass":"","tags":[],"seed":"","toneKeywords":[]}]}',
    params: { temperature: 1.05, maxTokens: 6000 },
    signal: opts.signal,
  });

  if (!res.ok) return { ok: false, candidates: [], error: res.error ?? "生成失败" };

  const data = res.parsed?.data;
  if (!res.parsed?.ok || data === undefined) {
    return { ok: false, candidates: [], error: res.parsed?.error ?? "模型没有返回可解析的 JSON，重试或换个模型试试" };
  }

  // 三种真实发生过的情况：正常 `{topics:[...]}`、被剥掉外壳直接给了数组、字段名被改写
  const rawList = Array.isArray(data)
    ? (data as unknown[]).filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    : asArrayAny<Record<string, unknown>>(data as Record<string, unknown>, "topics", "items", "candidates", "list");

  const candidates = rawList
    .map((raw) => toTemplate(raw, category, opts))
    .filter((t): t is NovelTemplate => t !== null)
    .slice(0, count);

  if (!candidates.length) {
    return { ok: false, candidates: [], error: "模型没给出可用的选题（书名或一句话故事是空的），再试一次" };
  }
  return { ok: true, candidates };
}

/** 把模型返回的一条选题归一化成 NovelTemplate；缺关键字段的直接丢弃 */
function toTemplate(
  raw: Record<string, unknown>,
  fallbackCategory: Exclude<TemplateCategory, "all"> | undefined,
  opts: TopicGenOptions,
): NovelTemplate | null {
  const name = pickStr(raw, "name", "title", "书名").slice(0, 60);
  const logline = pickStr(raw, "logline", "oneLiner", "oneliner", "一句话故事").slice(0, 120);
  if (!name || !logline) return null;

  const lenRaw = pickStr(raw, "lengthClass", "length", "篇幅") as LengthClass;
  const povRaw = pickStr(raw, "pov", "视角") as PovStyle;
  const category = fallbackCategory ?? "urban";
  const genres = asStringArray(raw.genres ?? raw["体裁"]).slice(0, 3);

  return {
    id: newId("tpl"),
    emoji: pickStr(raw, "emoji").slice(0, 4) || CATEGORY_EMOJI[category],
    name,
    logline,
    synopsis: pickStr(raw, "synopsis", "简介", "故事简介").slice(0, 600) || undefined,
    category,
    tags: asStringArray(raw.tags ?? raw["标签"]).slice(0, 5),
    genres: genres.length ? genres : (opts.genres?.slice(0, 3) ?? []),
    lengthClass: LENGTHS.includes(lenRaw) ? lenRaw : (opts.lengthClass ?? "novel"),
    pov: POVS.includes(povRaw) ? povRaw : (opts.pov ?? "third-limited"),
    seed: pickStr(raw, "seed", "种子").slice(0, 800) || undefined,
    toneKeywords: asStringArray(raw.toneKeywords ?? raw["基调词"]).slice(0, 4),
  };
}

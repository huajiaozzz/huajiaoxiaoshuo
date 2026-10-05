/**
 * 书库的书源。
 *
 * 1. 维基文库（zh.wikisource.org）：公版书。MediaWiki API 带 origin=* 就有 CORS 头，
 *    网页/桌面都能直连；正文用 action=parse 拿渲染后的 HTML，去表格/导航后转纯文本。
 *    章回顺序按「第X回」的数字排（兼容中文数字），抓不到子页就退回单页导入。
 *
 * 2. 连载书源（笔趣阁 www.biquge345.com、情豆书坊 qdsf.top）：免费连载书。
 *    两站结构同构（书页挂全量目录、章节页按数字编号），均无 CORS、站内搜索要登录，
 *    所以抽成配置驱动的通用引擎（SERIAL_SITES），统一走 Jina Reader 抓渲染页，入口有两个：
 *    - 粘贴书页链接 → 解析目录 → 逐章抓正文
 *    - 各站首页热门书聚合（fetchSerialHot）
 *    逐章抓取限速（Jina 免费档 20 次/分钟），单本默认上限 100 章 —— 拆书取样够用。
 *    连载作品版权在作者手里，这里只做个人学习技法参照，UI 上有注明。
 *    加新站点只需在 SERIAL_SITES 里加一份配置，引擎不用动。
 */
import { cleanPageTitle, extractChapter, jinaFetch, splitJinaPage } from "./webFetch";

const WS_API = "https://zh.wikisource.org/w/api.php";
/** 单本最多抓多少章：拆解靠取样，全量正文主要占本地存储 */
const MAX_CHAPTERS = 250;

async function wsGet(params: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ format: "json", origin: "*", ...params });
  const res = await fetch(WS_API + "?" + qs.toString(), { signal });
  if (!res.ok) throw new Error("维基文库接口异常（HTTP " + res.status + "）");
  return (await res.json()) as Record<string, unknown>;
}

export interface LibrarySearchItem {
  title: string;
  /** 带子页（书名/第X回）→ 整本可拆；否则是单页（一篇文章/一个章节） */
  isBook: boolean;
}

/** 书库搜索：维基文库全站标题搜索 */
export async function searchLibrary(query: string, signal?: AbortSignal): Promise<LibrarySearchItem[]> {
  const data = await wsGet({ action: "opensearch", search: query, limit: "12", redirect: "resolve" }, signal);
  const titles = (data?.[1] as string[] | undefined) ?? [];
  return titles.map((t) => ({ title: t, isBook: t.includes("/") }));
}

/* ---------------- 中文数字 → 阿拉伯数字（章回排序用） ---------------- */

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 「一百二十三」→ 123；只处理到千位，章回号足够了 */
function cnToNumber(s: string): number {
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let current = 0;
  for (const ch of s) {
    const d = CN_DIGIT[ch];
    if (d !== undefined) {
      current = current * 10 + (current > 0 ? d : d);
      if (current === 0) current = d;
    } else if (ch === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (ch === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else if (ch === "千") {
      total += (current || 1) * 1000;
      current = 0;
    } else if (ch === "两" || ch === "兩") {
      current = current * 10 + 2;
    } else {
      return NaN;
    }
  }
  return total + current;
}

/* ---------------- 正文抓取 ---------------- */

/** 把维基文库渲染出来的 HTML 洗成正文纯文本（去表格/导航，保留段落分隔） */
function htmlToText(html: string): string {
  const withBreaks = html.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|dd|dt)>/gi, "</$1>\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  doc.querySelectorAll("table, style, script, .mw-editsection, .noprint, sup.reference, .printfooter").forEach((el) => el.remove());
  const root = doc.querySelector(".mw-parser-output") ?? doc.body;
  return (root?.textContent ?? "")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchPageText(title: string, signal?: AbortSignal): Promise<string> {
  const data = await wsGet({ action: "parse", page: title, prop: "text", formatversion: "2", origin: "*" }, signal);
  const html = (data as { parse?: { text?: string } }).parse?.text ?? "";
  return htmlToText(html);
}

export interface FetchBookResult {
  title: string;
  text: string;
  chapterCount: number;
}

/**
 * 抓一整本书：prefix 有子页就逐章抓（并发 4，带进度），没有就整页导入。
 * 每章以「章节标题 + 空行 + 正文」拼接 —— 下游的自动分章直接认这个格式。
 */
export async function fetchBookText(
  prefix: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<FetchBookResult> {
  // 1. 子页列表（带分页续传）
  let titles: string[] = [];
  let apcontinue: string | undefined;
  do {
    const data = await wsGet(
      {
        action: "query", list: "allpages", apprefix: prefix + "/", aplimit: "max",
        format: "json", origin: "*", ...(apcontinue ? { apcontinue } : {}),
      },
      signal,
    );
    const q = (data as { query?: { allpages?: { title: string }[] } }).query?.allpages ?? [];
    titles.push(...q.map((x) => x.title));
    apcontinue = (data as { continue?: { apcontinue?: string } }).continue?.apcontinue;
  } while (apcontinue && titles.length < MAX_CHAPTERS);

  titles = [...new Set(titles)].sort((a, b) => {
    const wa = chapterWeight(a);
    const wb = chapterWeight(b);
    if (wa !== wb) return wa - wb;
    return a.localeCompare(b, "zh-Hant");
  });

  const pages = (titles.length ? titles : [prefix]).slice(0, MAX_CHAPTERS);
  const parts: string[] = [];
  const batchSize = 4;

  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    const texts = await Promise.all(batch.map((t) => fetchPageText(t, signal)));
    batch.forEach((t, j) => {
      const body = texts[j];
      if (body.replace(/\s/g, "").length < 20) return;
      parts.push(t.split("/").pop()!.trim() + "\n\n" + body);
    });
    onProgress?.(Math.min(i + batchSize, pages.length), pages.length);
  }

  const text = parts.join("\n\n\n").trim();
  if (!text) throw new Error("这本书没抓到正文（可能结构特殊），换个来源或手动粘贴");
  return { title: prefix, text, chapterCount: parts.length };
}

/* ---------------- 连载书源（配置驱动的通用引擎） ----------------
 * 笔趣阁（www.biquge345.com）、情豆书坊（qdsf.top）这类站点结构同构：
 * 书页挂全量目录、章节页按数字编号，均无 CORS、站内搜索要登录，
 * 统一走 Jina Reader 抓渲染页。加新站点 = 在 SERIAL_SITES 里加一份配置。
 */

/** 单本默认抓多少章：Jina 免费档 20 次/分钟，100 章约 5-7 分钟 */
export const SERIAL_MAX_CHAPTERS = 100;

interface SerialSite {
  /** 展示名（书库里的站点小标签） */
  label: string;
  base: string;
  /** 目录页（书页）URL 特征：识别用户粘贴的链接属于哪个站 */
  tocUrlRe: RegExp;
  /** 目录页里的章节 <a>：捕获组 1 = 章节地址（可能相对），2 = 锚文本 */
  tocLinkRe: RegExp;
  /** 站点 <title> 特有的 SEO 尾巴（在 cleanPageTitle 之后追加清洗） */
  titleJunkRe?: RegExp;
  /** 首页 markdown 里的书页链接（热门书聚合）：捕获组 1 = 书名，2 = 链接 */
  homeLinkRe: RegExp;
}

const SERIAL_SITES: SerialSite[] = [
  {
    label: "笔趣阁",
    base: "https://www.biquge345.com",
    tocUrlRe: /^https?:\/\/www\.biquge345\.com\/book\/\d+\/?$/,
    tocLinkRe: /<a[^>]*href="((?:https?:\/\/www\.biquge345\.com)?\/chapter\/\d+\/\d+\.html)"[^>]*>([^<]{1,60})<\/a>/g,
    homeLinkRe: /\[([^\]]{1,60})\]\((https?:\/\/www\.biquge345\.com\/book\/\d+\/?)\)/g,
  },
  {
    label: "情豆书坊",
    base: "https://qdsf.top",
    tocUrlRe: /^https?:\/\/(?:www\.)?qdsf\.top\/novel\/\d+\.html$/,
    tocLinkRe: /<a[^>]*href="((?:https?:\/\/(?:www\.)?qdsf\.top)?\/novel\/\d+_\d+\.html)"[^>]*>([^<]{1,60})<\/a>/g,
    titleJunkRe: /\s*免费在线阅读.*$/,
    homeLinkRe: /\[([^\]]{1,60})\]\((https?:\/\/(?:www\.)?qdsf\.top\/novel\/\d+\.html)\)/g,
  },
];

/** 用户粘贴的链接属于哪个连载站点；都不匹配 = 不支持 */
export function detectSerialSite(bookUrl: string): SerialSite | undefined {
  return SERIAL_SITES.find((s) => s.tocUrlRe.test(bookUrl.trim()));
}

/** 书库 UI 展示用：各书源站点首页链接（站内搜索要登录，用户得自己去站点找书） */
export const SERIAL_SITE_LINKS: { label: string; url: string }[] = SERIAL_SITES.map((s) => ({
  label: s.label,
  url: s.base,
}));

export interface SerialChapterLink {
  url: string;
  /** 目录里的章节标题（用于排序与兜底命名） */
  anchor: string;
}

export interface SerialBookLink {
  title: string;
  url: string;
  /** 来自哪个站点（笔趣阁 / 情豆书坊…） */
  site: string;
}

/** 章回排序权重：正文按章号，番外放最后，序章/楔子放最前 */
function chapterWeight(title: string): number {
  if (/^番外/.test(title)) return 1_000_000 + (cnToNumber(title.replace(/^番外/, "")) || 0);
  if (/^(序章|楔子|引子|序言)/.test(title)) return -1;
  const m = title.match(/第\s*([0-9零〇一二三四五六七八九十百千万兩两]+)\s*[章回节卷篇]/);
  if (!m) return Number.MAX_SAFE_INTEGER - 1;
  const n = cnToNumber(m[1]);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER - 1 : n;
}

/** 锚文本像章节才收：目录里混着的「开始阅读」「新书发布」这类推广链接靠它排除 */
function isChapterAnchor(anchor: string): boolean {
  return /第\s*[0-9零一二三四五六七八九十百千万兩两]+\s*[章回节]/.test(anchor) || /^(?:番外|序章|楔子|引子)/.test(anchor);
}

/** 热门书标题洗成干净书名：去书名号包装、截掉「作者：xx」 */
function cleanHotTitle(raw: string): string {
  return raw.replace(/[《》【】]/g, "").split(/\s*作者[:：]/)[0].trim();
}

/** 首页热门书聚合：抓各站首页 markdown 里的书页链接，合并成一个列表（单站挂了不影响另一站） */
export async function fetchSerialHot(signal?: AbortSignal): Promise<SerialBookLink[]> {
  const perSite = await Promise.allSettled(
    SERIAL_SITES.map(async (site): Promise<SerialBookLink[]> => {
      const raw = await jinaFetch(site.base + "/", { signal });
      const { md } = splitJinaPage(raw);
      const found = new Map<string, SerialBookLink>();
      for (const m of md.matchAll(site.homeLinkRe)) {
        const title = cleanHotTitle(m[1]);
        if (!title || title.length < 2) continue;
        if (!found.has(m[2])) found.set(m[2], { title, url: m[2], site: site.label });
      }
      return [...found.values()].slice(0, 12);
    }),
  );
  const merged = perSite.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (merged.length === 0) throw new Error("各站点首页都没解析到书，可能临时打不开，稍后再试");
  return merged;
}

/** 解析书页（目录）：书名 + 章节链接（HTML 模式拿全量目录，markdown 会漏） */
export async function parseSerialToc(
  bookUrl: string,
  signal?: AbortSignal,
): Promise<{ title: string; chapters: SerialChapterLink[] }> {
  const site = detectSerialSite(bookUrl);
  if (!site) {
    throw new Error(
      "目前支持这些站点的书籍目录页：" + SERIAL_SITES.map((s) => s.label + "（" + s.base + "）").join("、"),
    );
  }
  const html = await jinaFetch(bookUrl, { returnHtml: true, signal });
  const chapters: SerialChapterLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(site.tocLinkRe)) {
    const anchor = m[2].trim();
    if (!isChapterAnchor(anchor)) continue;
    const url = m[1].startsWith("http") ? m[1] : site.base + m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    chapters.push({ url, anchor });
  }
  if (chapters.length === 0) throw new Error("这个书页里没解析到章节链接，确认贴的是书籍目录页");
  // 有的站目录里「最新章节区」排在正文目录前，按章号重排；番外排到最后
  chapters.sort((a, b) => chapterWeight(a.anchor) - chapterWeight(b.anchor));
  const t = html.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
  const title = cleanPageTitle(t).replace(site.titleJunkRe ?? /$^/, "").trim() || "书页导入";
  return { title, chapters };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

/** 抓单章并洗成纯正文（复用网址导入的 chrome 清洗；章节标题优先取正文里的章回标题） */
async function fetchSerialChapter(url: string, signal?: AbortSignal): Promise<{ title: string; text: string }> {
  const raw = await jinaFetch(url, { signal });
  const { pageTitle, md } = splitJinaPage(raw);
  return extractChapter(md, cleanPageTitle(pageTitle));
}

export interface FetchSerialResult {
  title: string;
  text: string;
  chapterCount: number;
  /** 章节列表比上限长时为 true（提示用户只抓了前 N 章） */
  truncated: boolean;
}

/**
 * 抓整本连载书：识别站点 → 目录 → 逐章（限速 + 进度）。章节多于上限时只抓前 N 章。
 */
export async function fetchSerialBook(
  bookUrl: string,
  opts: { maxChapters?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<FetchSerialResult> {
  const max = Math.max(1, Math.min(SERIAL_MAX_CHAPTERS, opts.maxChapters ?? SERIAL_MAX_CHAPTERS));
  const { title, chapters } = await parseSerialToc(bookUrl, opts.signal);
  const queue = chapters.slice(0, max);
  const truncated = chapters.length > max;
  const parts: string[] = [];

  for (let i = 0; i < queue.length; i++) {
    opts.onProgress?.(i, queue.length);
    let page: { title: string; text: string };
    try {
      page = await fetchSerialChapter(queue[i].url, opts.signal);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // 单章失败不放弃整本：跳过并继续
      page = { title: "", text: "" };
    }
    if (page.text.replace(/\s/g, "").length >= 20) {
      parts.push((page.title || queue[i].anchor) + "\n\n" + page.text);
    }
    // Jina 免费档限速：每章之间留出间隔
    if (i < queue.length - 1) await sleep(1500, opts.signal);
  }
  opts.onProgress?.(queue.length, queue.length);

  const text = parts.join("\n\n\n").trim();
  if (!text) throw new Error("一章都没抓到（站点可能临时打不开），稍后再试");
  return { title, text, chapterCount: parts.length, truncated };
}

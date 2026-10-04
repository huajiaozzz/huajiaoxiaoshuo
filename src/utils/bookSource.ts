/**
 * 书库的书源：维基文库（zh.wikisource.org）。
 *
 * MediaWiki API 带 origin=* 就有 CORS 头，网页/桌面都能直连；正文用
 * action=parse 拿渲染后的 HTML，去表格/导航后转纯文本。章回顺序按
 * 「第X回」的数字排（兼容中文数字），抓不到子页就退回单页导入。
 */

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

function chapterWeight(title: string): number {
  const m = title.match(/第\s*([0-9零〇一二三四五六七八九十百千万兩两]+)\s*[章回节卷篇]/);
  if (!m) return Number.MAX_SAFE_INTEGER - 1;
  const n = cnToNumber(m[1]);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER - 1 : n;
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

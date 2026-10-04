/**
 * 网页正文抓取：给「拆书仿写」的网址导入用。
 *
 * 浏览器直接 fetch 任意网页会被 CORS 拦，自建代理又要多部署一个服务；
 * 这里走 Jina Reader（r.jina.ai）：带 CORS 头、返回提取好的正文 markdown、
 * 网页版与桌面版都能用。注意：抓取时目标 URL 会经由该第三方服务 ——
 * 界面上要写明。之后正文去向与粘贴相同（只进你配置的模型做拆解）。
 *
 * Jina 返回的是整页 markdown，带着站点导航/控制项，所以抓完再做一层
 * 「只留标题 + 正文」的清洗（extractChapter）：按小说章节页的排版规律裁剪。
 */

const READER_PREFIX = "https://r.jina.ai/";

export interface FetchedPage {
  /** 章节标题：优先取正文里的章回标题，读不到就回退页面标题 */
  title: string;
  /** 清洗后的正文（已去掉导航/列表/控制项，只留正文段落） */
  text: string;
}

/** 补协议 + 只放行 http/https，防着把奇怪的东西喂给 reader */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("网址是空的");
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : "https://" + trimmed;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("网址格式不对，检查一下");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只支持 http/https 网址");
  }
  return parsed.href;
}

const HEADING_MARK_RE = /^\s{0,3}#{1,6}\s+/;
const LIST_LINE_RE = /^\s*(?:[-*+]\s|\d{1,3}[.、)]\s*)/;
/** 章节标题：第X章/回/节、楔子、序章、引子、Chapter N */
const CHAPTER_TITLE_RE = /^(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节].*|楔子.*|序章.*|序言.*|引子.*|Chapter\s+\d+.*)$/i;
/** 站点控制项/推广话术 —— 出现在行首（可带 # 记号）就当 chrome 丢掉 */
const CHROME_LINE_RE =
  /^(?:上一[章页]|下一[章页]|[返回]?目录|章节目录|加入书签|添加书签|书签|举报|错误举报|去广告|广告|最新章节|新书推荐|点击下一页|继续阅读|开始阅读|立即阅读|版权所有|免责声明|网站地图|联系我[们]?|关于我[们]?|首页|登录|注册|下载(?:本)?(?:书|APP)|APP下载|求收藏|求推荐|求月票|请收藏本站|本书(?:来自|由)|转载自|章节错误?|手机(?:阅读|版)|客户端|跳转到内容|移至侧栏|主菜单|导航|搜索|分享到|随机作品|返回书页)/;

/** 正文段落的门槛：够长的行才算内容（导航和按钮都是短行） */
const CONTENT_MIN = 25;

function isChromeLine(line: string): boolean {
  const wasHeading = HEADING_MARK_RE.test(line);
  const t = line.replace(HEADING_MARK_RE, "").trim();
  if (!t) return false;
  if (LIST_LINE_RE.test(line)) return true;
  if (CHROME_LINE_RE.test(t) && t.length <= 60) return true;
  // 标题行里带站点词的（「XX小说网最新章节列表」「全书目录」这类）整行丢弃
  if (wasHeading && t.length <= 40 && /(最新章节|章节目录|目录|小说网|笔趣阁|无弹窗|txt下载|全书阅读|栏目)/.test(t)) return true;
  // 短行且带 markdown 链接的，基本都是导航（正文段落很少整行是链接）
  if (t.length <= 20 && /\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  return false;
}

function isContentLine(line: string): boolean {
  const t = line.replace(HEADING_MARK_RE, "").trim();
  return t.length >= CONTENT_MIN && !CHROME_LINE_RE.test(t);
}

/**
 * 从整页 markdown 里抠出「章节标题 + 正文」。
 * 策略：丢列表行/控制项行 → 标题取第一个章回样式的行（没有就退页面标题）→
 * 正文裁到首尾两个"够长"的段落之间（把头尾的站点包装剪掉）。
 * 裁完不足 400 字时视为误判，退回未裁剪的版本 —— 宁可多带点杂也不丢正文。
 */
/** 供测试与调用方复用：从整页 markdown 抠「标题 + 正文」 */
export function extractChapter(md: string, pageFallbackTitle: string): { title: string; text: string } {
  // 保留原始行：isChromeLine 要看这行原本是不是 markdown 标题（站点 chrome 常以标题形式出现）
  const rawLines = md.split(/\n/).map((l) => l.trim());

  // 标题：第一个章回样式的行
  let title = "";
  let titleIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].replace(HEADING_MARK_RE, "").trim();
    if (t && t.length <= 50 && CHAPTER_TITLE_RE.test(t)) {
      title = t;
      titleIdx = i;
      break;
    }
  }

  // 去掉列表行、控制项行、图片行；空行保留当段落分隔
  const kept = rawLines.filter((l, i) => {
    if (!l) return true;
    if (i === titleIdx) return false;
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(l)) return false;
    if (isChromeLine(l)) return false;
    return true;
  });

  // 裁剪：首尾两个"够长"的行之间才是正文
  let start = 0;
  let end = kept.length - 1;
  while (start <= end && !isContentLine(kept[start])) start++;
  while (end >= start && !isContentLine(kept[end])) end--;
  let bodyLines = start <= end ? kept.slice(start, end + 1) : kept;
  let body = bodyLines
    .map((l) => l.replace(HEADING_MARK_RE, "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (body.replace(/\s+/g, "").length < 400) {
    // 裁狠了（正文被判成 chrome）—— 退回"只去 chrome、不裁剪"的版本，宁可多带杂不丢正文
    const loose = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (loose.replace(/\s+/g, "").length > body.replace(/\s+/g, "").length) body = loose;
  }

  return { title: title || pageFallbackTitle, text: body };
}

export async function fetchPageText(rawUrl: string): Promise<FetchedPage> {
  const url = normalizeUrl(rawUrl);
  // 抓取偶发失败（上游站点慢/连接重置），带超时重试一次再放弃
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(READER_PREFIX + url, { headers: { Accept: "text/plain" }, signal: ctrl.signal });
      if (res.status === 429) throw new Error("读取太频繁，稍等一分钟再试");
      if (!res.ok) {
        throw new Error("读取失败（HTTP " + res.status + "）：这个网址可能需要登录、或页面是纯脚本渲染的，那就只能手动复制正文了");
      }
      const raw = (await res.text()).trim();
      if (!raw) throw new Error("读到了空页面");
      // Jina 的返回格式：Title: … / URL Source: … / Markdown Content: …
      const titleMatch = raw.match(/^Title:\s*(.+)$/m);
      const pageTitle = (titleMatch?.[1] ?? "").trim().replace(/\s*[-–—|].*$/, "").trim(); // 去掉「- 站点名」后缀
      const contentMatch = raw.match(/^Markdown Content:\s*([\s\S]*)$/m);
      const md = contentMatch?.[1] ?? raw;
      const { title, text } = extractChapter(md, pageTitle);
      if (!text) throw new Error("页面里没提取到正文");
      return { title, text };
    } catch (e) {
      // 带业务信息的错误直接抛，不重试（重试也没用）
      if (e instanceof Error && /读取失败|读取太频繁|读到了空页面|没提取到正文/.test(e.message)) throw e;
      lastErr = e;
      if (attempt === 1) break;
    } finally {
      clearTimeout(timer);
    }
  }
  const aborted = lastErr instanceof Error && lastErr.name === "AbortError";
  throw new Error(aborted ? "读取超时（这个站点响应太慢），稍后再试或手动复制" : "连不上网页读取服务，检查网络后重试");
}

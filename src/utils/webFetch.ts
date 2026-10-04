/**
 * 网页正文抓取：给「拆书仿写」的网址导入用。
 *
 * 浏览器直接 fetch 任意网页会被 CORS 拦，自建代理又要多部署一个服务；
 * 这里走 Jina Reader（r.jina.ai）：带 CORS 头、返回提取好的正文 markdown、
 * 网页版与桌面版都能用。注意：抓取时目标 URL 会经由该第三方服务 ——
 * 界面上要写明。之后正文去向与粘贴相同（只进你配置的模型做拆解）。
 */

const READER_PREFIX = "https://r.jina.ai/";

export interface FetchedPage {
  /** 页面标题（Jina 返回的 Title 行）；读不到就回退 URL */
  title: string;
  /** 提取出的正文（已去掉 markdown 链接/图片/标题记号，保留纯文本段落） */
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

/** 把 Jina 返回的 markdown 粗略洗成纯文本段落：去图片/链接/标题记号/强调符 */
function markdownToText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接只留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题记号
    .replace(/(\*\*|__|`)/g, "") // 强调/代码记号
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
      const contentMatch = raw.match(/^Markdown Content:\s*([\s\S]*)$/m);
      const title = (titleMatch?.[1] ?? "").trim();
      const text = markdownToText(contentMatch?.[1] ?? raw);
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

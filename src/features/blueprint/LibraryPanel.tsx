import { useState } from "react";
import { Button, Card, Chip, Input } from "@/components/kit";
import { BookOpen, Download, ExternalLink, Link2, RefreshCw, Search, Sparkles } from "lucide-react";
import type { ID } from "@/core";
import { BOOK_LIBRARY } from "@/core/bookLibrary";
import {
  detectSerialSite, fetchSerialBook, fetchSerialHot, fetchBookText, searchLibrary,
  type LibrarySearchItem, type SerialBookLink, SERIAL_SITE_LINKS,
} from "@/utils/bookSource";
import { useAppStore } from "@/app/store";
import { Progress, SectionTitle } from "@/components/common/ui";

type BookSource = "wikisource" | "serial";

/**
 * 书库：两个免费书源的聚合入口。
 *
 * · 公版书库（维基文库）——内置名著目录 + 全站搜索，逐章 API 抓取，快且稳；
 * · 连载书源（笔趣阁 / 情豆书坊）——站内搜索要登录，所以支持「粘贴书页链接导入」
 *   和「首页热门书聚合」，逐章经 Jina 抓取（限速，单本默认前 100 章）。
 * 两个源导入成功后都回调 onPicked —— 父层接进拆书流程自动拆。
 */
export function LibraryPanel({ projectId, onPicked }: { projectId: ID; onPicked: (title: string, text: string) => void }) {
  const notify = useAppStore((s) => s.notify);
  const [source, setSource] = useState<BookSource>("wikisource");

  // ---- 公版书库（维基文库）----
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LibrarySearchItem[] | null>(null);
  const [catalogFilter, setCatalogFilter] = useState("");

  // ---- 连载书源（多站点，贴链接自动识别）----
  const [serialUrl, setSerialUrl] = useState("");
  const [hot, setHot] = useState<SerialBookLink[] | null>(null);
  const [hotLoading, setHotLoading] = useState(false);
  const serialSite = detectSerialSite(serialUrl);

  const [importing, setImporting] = useState<{ label: string; done: number; total: number } | null>(null);

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setResults(null);
    try {
      const found = await searchLibrary(query.trim());
      setResults(found);
      if (found.length === 0) notify("info", "没搜到", "换个关键词试试，或者直接贴网址导入");
    } catch (e) {
      notify("danger", "搜索失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const loadHot = async () => {
    setHotLoading(true);
    try {
      setHot(await fetchSerialHot());
    } catch (e) {
      notify("danger", "热门书抓取失败", e instanceof Error ? e.message : String(e));
    } finally {
      setHotLoading(false);
    }
  };

  const importWiki = async (label: string, prefix: string) => {
    if (importing) return;
    setImporting({ label, done: 0, total: 1 });
    try {
      const res = await fetchBookText(prefix, (done, total) => setImporting({ label, done, total }));
      setImporting(null);
      notify("success", "已抓取「" + label + "」", res.chapterCount + " 章，开始拆解");
      onPicked(label, res.text);
    } catch (e) {
      setImporting(null);
      notify("danger", "导入失败", e instanceof Error ? e.message : String(e));
    }
  };

  const importSerial = async (label: string, bookUrl: string) => {
    if (importing) return;
    setImporting({ label, done: 0, total: 100 });
    try {
      const res = await fetchSerialBook(bookUrl, {
        onProgress: (done, total) => setImporting({ label, done, total }),
      });
      setImporting(null);
      notify(
        "success",
        "已抓取「" + res.title + "」",
        res.chapterCount + " 章" + (res.truncated ? "（章节太多，只抓了前 100 章）" : "") + "，开始拆解",
      );
      onPicked(res.title || label, res.text);
    } catch (e) {
      setImporting(null);
      notify("danger", "导入失败", e instanceof Error ? e.message : String(e));
    }
  };

  const busy = importing !== null;
  const catalog = BOOK_LIBRARY.filter((b) =>
    !catalogFilter.trim() ? true : (b.title + b.author).toLowerCase().includes(catalogFilter.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <SectionTitle hint="聚合免费书源：公版名著逐章 API 抓取，连载书走网页读取；选一本自动拆解">书库</SectionTitle>

      {/* 书源切换 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-black/10 p-0.5 text-xs dark:border-white/15">
          {(
            [
              { id: "wikisource" as BookSource, label: "公版书库 · 维基文库" },
              { id: "serial" as BookSource, label: "连载书源 · 笔趣阁 / 情豆书坊" },
            ]
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSource(s.id)}
              className={
                "rounded-md px-2.5 py-1 transition " +
                (source === s.id ? "bg-black/[0.07] font-medium dark:bg-white/[0.12]" : "opacity-55 hover:opacity-100")
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 抓取进度 */}
      {importing && (
        <Card className="p-4">
          <p className="text-xs font-medium">
            正在抓取「{importing.label}」
            {importing.total > 1 && importing.done > 0 ? ` · ${importing.done}/${importing.total} 章` : ""}
          </p>
          <Progress value={importing.done} max={importing.total} />
          <p className="mt-1.5 text-[11px] opacity-55">抓完自动分章、拆技法与棋子表、存成模板 —— 全程无需再操作</p>
        </Card>
      )}

      {source === "wikisource" ? (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜书名 / 作者（维基文库全站）"
                className="min-w-56 flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doSearch();
                }}
              />
              <Button size="sm" variant="outline" isPending={searching} isDisabled={!query.trim()} onPress={() => void doSearch()}>
                <Search className="size-3.5" />
                搜索
              </Button>
            </div>

            {results !== null && (
              <div className="mt-3 space-y-1.5">
                {results.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-black/10 px-3 py-4 text-center text-xs opacity-50 dark:border-white/15">
                    没搜到，换个关键词
                  </p>
                ) : (
                  results.map((item) => (
                    <div
                      key={item.title}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-black/8 px-2.5 py-1.5 dark:border-white/10"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs">{item.title}</span>
                      <Chip>{item.isBook ? "整本" : "单页"}</Chip>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={busy}
                        onPress={() => void importWiki(item.title, item.title)}
                      >
                        <Download className="size-3.5" />
                        一键拆书
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium">公版名著（{BOOK_LIBRARY.length} 部，点击即拆）</p>
              <Input
                value={catalogFilter}
                onChange={(e) => setCatalogFilter(e.target.value)}
                placeholder="筛选…"
                className="w-36"
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {catalog.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded-lg border border-black/8 px-2.5 py-2 dark:border-white/10"
                >
                  <BookOpen className="size-4 shrink-0 opacity-40" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{b.title}</p>
                    <p className="text-[11px] opacity-50">{b.author} · 维基文库</p>
                  </div>
                  <Button size="sm" variant="outline" isDisabled={busy} onPress={() => void importWiki(b.title, b.prefix)}>
                    <Sparkles className="size-3.5" />
                    一键拆书
                  </Button>
                </div>
              ))}
              {catalog.length === 0 && (
                <p className="col-span-full rounded-lg border border-dashed border-black/10 px-3 py-4 text-center text-xs opacity-50 dark:border-white/15">
                  目录里没有匹配的，用上面的搜索找
                </p>
              )}
            </div>
          </Card>
        </>
      ) : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={serialUrl}
                onChange={(e) => setSerialUrl(e.target.value)}
                placeholder="粘贴书籍目录页链接（笔趣阁 /book/{id}/ 或 情豆书坊 /novel/{id}.html）"
                className="min-w-56 flex-1"
              />
              {serialUrl.trim() && (
                <Chip>{serialSite ? "站点：" + serialSite.label : "不支持的站点"}</Chip>
              )}
              <Button
                size="sm"
                variant="outline"
                isDisabled={!serialSite || busy}
                onPress={() => serialSite && void importSerial("书页导入", serialUrl.trim())}
              >
                <Link2 className="size-3.5" />
                导入并拆书
              </Button>
              <Button size="sm" variant="ghost" isPending={hotLoading} isDisabled={busy} onPress={() => void loadHot()}>
                <RefreshCw className="size-3.5" />
                刷新热门书
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed opacity-55">
              这些站站内搜索要登录，所以支持不了关键词搜索：在站点里找到书，把目录页链接贴进来即可
              （自动识别是哪个站）；或从下面的热门书里选。连载书章节太多，默认只抓前 100 章（拆书取样足够），
              逐章限速抓取约需几分钟。仅供个人学习写法，请支持正版。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="opacity-55">书源站点：</span>
              {SERIAL_SITE_LINKS.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline decoration-black/25 underline-offset-2 transition hover:decoration-black/60 dark:decoration-white/30 dark:hover:decoration-white/70"
                >
                  {s.label} {s.url.replace(/^https?:\/\//, "")}
                  <ExternalLink className="size-3 opacity-50" />
                </a>
              ))}
            </div>

            {hot !== null && (
              <div className="mt-3 space-y-1.5">
                {hot.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-black/10 px-3 py-4 text-center text-xs opacity-50 dark:border-white/15">
                    首页没解析到书，直接贴链接导入
                  </p>
                ) : (
                  hot.map((b) => (
                    <div
                      key={b.url}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-black/8 px-2.5 py-1.5 dark:border-white/10"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs">{b.title}</span>
                      <Chip>{b.site}</Chip>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={busy}
                        onPress={() => void importSerial(b.title, b.url)}
                      >
                        <Download className="size-3.5" />
                        一键拆书
                      </Button>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

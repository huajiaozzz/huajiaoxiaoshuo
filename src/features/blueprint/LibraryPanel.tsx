import { useState } from "react";
import { Button, Card, Chip, Input } from "@/components/kit";
import { BookOpen, Download, Search, Sparkles } from "lucide-react";
import type { ID } from "@/core";
import { BOOK_LIBRARY } from "@/core/bookLibrary";
import { fetchBookText, searchLibrary, type LibrarySearchItem } from "@/utils/bookSource";
import { useAppStore } from "@/app/store";
import { Progress, SectionTitle } from "@/components/common/ui";

/**
 * 书库：免费公版书（维基文库）聚合 + 搜索 + 一键拆书。
 *
 * - 内置目录：14 部已验证结构的公版名著，点一下就抓全书；
 * - 搜索：维基文库全站标题搜索，带子页的当整本拆，单页的当一篇拆；
 * - 导入成功后回调 onPicked —— 父层把文本接进拆书流程并跳到拆解结果。
 *
 * 抓取只发生在你点「一键拆书」时：维基文库是公版书，没有版权问题。
 */
export function LibraryPanel({ projectId, onPicked }: { projectId: ID; onPicked: (title: string, text: string) => void }) {
  const notify = useAppStore((s) => s.notify);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LibrarySearchItem[] | null>(null);
  const [importing, setImporting] = useState<{ label: string; done: number; total: number } | null>(null);
  const [catalogFilter, setCatalogFilter] = useState("");

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

  const importBook = async (label: string, prefix: string) => {
    if (importing) return;
    setImporting({ label, done: 0, total: 1 });
    try {
      const res = await fetchBookText(prefix, (done, total) => setImporting({ label, done, total }));
      setImporting(null);
      notify("success", "已抓取「" + label + "」", res.chapterCount + " 章 · 共 " + Math.round(res.text.length / 1000) + "k 字，开始拆解");
      onPicked(label, res.text);
    } catch (e) {
      setImporting(null);
      notify("danger", "导入失败", e instanceof Error ? e.message : String(e));
    }
  };

  const catalog = BOOK_LIBRARY.filter((b) =>
    !catalogFilter.trim() ? true : (b.title + b.author).toLowerCase().includes(catalogFilter.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <SectionTitle hint="免费公版书，聚合自维基文库；选一本一键抓全书并自动拆解">书库</SectionTitle>

      {/* 在线搜索 */}
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
                    isPending={importing?.label === item.title}
                    isDisabled={Boolean(importing)}
                    onPress={() => void importBook(item.title, item.title)}
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

      {/* 抓取进度 */}
      {importing && (
        <Card className="p-4">
          <p className="text-xs font-medium">
            正在抓取「{importing.label}」
            {importing.total > 1 ? ` · ${importing.done}/${importing.total} 章` : ""}
          </p>
          <Progress value={importing.done} max={importing.total} />
          <p className="mt-1.5 text-[11px] opacity-55">抓完自动分章、拆技法与棋子表、存成模板 —— 全程无需再操作</p>
        </Card>
      )}

      {/* 内置公版书目录 */}
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
              <Button
                size="sm"
                variant="outline"
                isPending={importing?.label === b.title}
                isDisabled={Boolean(importing)}
                onPress={() => void importBook(b.title, b.prefix)}
              >
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
    </div>
  );
}

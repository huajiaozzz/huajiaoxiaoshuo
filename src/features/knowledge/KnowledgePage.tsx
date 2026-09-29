import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Card } from "@/components/kit";
import { FileText, RefreshCw } from "lucide-react";
import { KNOWLEDGE_LABEL, type KnowledgeKind, type KnowledgePage } from "@/core";
import { PageScaffold } from "@/components/common/PageScaffold";
import { EmptyHint, Loading } from "@/components/common/ui";
import { Markdown } from "@/features/ai/Markdown";
import { useAsync } from "@/app/hooks";
import { SlidingTabs } from "@/components/common/SlidingTabs";
import {
  KNOWLEDGE_KINDS, getKnowledgePage, isKnowledgeStale, refreshKnowledge,
} from "@/db/repo/knowledge";

/**
 * 知识页：按主题自动组装的 condensed 页面（人物小传 / 世界观总览 / 伏笔总览）。
 *
 * 内容不是手写的 —— 每次打开时用源数据指纹比对，变了就标"已过期"，
 * 点更新重新组装。适合开着对照写作，也适合喂给模型当压缩上下文。
 */
export function KnowledgePage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const [kind, setKind] = useState<KnowledgeKind>("characters");
  const [refreshing, setRefreshing] = useState(false);

  const pageRes = useAsync(async (): Promise<{ page?: KnowledgePage; stale: boolean }> => {
    const [page, stale] = await Promise.all([
      getKnowledgePage(projectId, kind),
      isKnowledgeStale(projectId, kind),
    ]);
    return { page, stale };
  }, [projectId, kind], null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refreshKnowledge(projectId, kind);
      pageRes.reload();
    } finally {
      setRefreshing(false);
    }
  };

  const loaded = !pageRes.loading && pageRes.value !== null;
  const page = pageRes.value?.page;
  const stale = pageRes.value?.stale ?? false;

  return (
    <PageScaffold
      title="知识页"
      description="源数据自动组装的 condensed 页面 · 过期了点一下更新"
      actions={
        <Button size="sm" variant="outline" isPending={refreshing} onPress={() => void refresh()}>
          <RefreshCw className="size-3.5" />
          更新本页
        </Button>
      }
    >
      <SlidingTabs
        value={kind}
        onChange={(v) => setKind(v as KnowledgeKind)}
        items={KNOWLEDGE_KINDS.map((k) => ({ value: k, label: KNOWLEDGE_LABEL[k] }))}
      />
      <div className="mt-4">
        {!loaded ? (
          <Loading label="正在组装…" />
        ) : !page ? (
          <EmptyHint
            icon={<FileText className="size-8" />}
            title="还没有内容"
            description="源数据是空的，先去人物 / 世界观 / 伏笔页建一些条目，再回来更新本页。"
            action={
              <Button size="sm" variant="primary" isPending={refreshing} onPress={() => void refresh()}>
                生成本页
              </Button>
            }
          />
        ) : (
          <Card className="p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs opacity-55">
              <span>{KNOWLEDGE_LABEL[kind]}</span>
              <span>·</span>
              <span>更新于 {new Date(page.updatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
              {stale && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                  源数据变了，已过期
                </span>
              )}
            </div>
            <Markdown text={page.content} />
          </Card>
        )}
      </div>
    </PageScaffold>
  );
}

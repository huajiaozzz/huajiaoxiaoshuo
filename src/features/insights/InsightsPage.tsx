import { useState } from "react";
import { useParams } from "react-router-dom";
import { PageScaffold } from "@/components/common/PageScaffold";
import { SlidingTabs, SlidingTabsPanel } from "@/components/common/SlidingTabs";
import { Loading } from "@/components/common/ui";
import { useChapters, useProject } from "@/app/hooks";
import { formatWords } from "@/utils/format";
import { WritingTrend } from "./WritingTrend";
import { MetricsCurve } from "./MetricsCurve";
import { StyleFingerprintPanel } from "./StyleFingerprintPanel";
import { LocalAuditPanel } from "./LocalAuditPanel";
import { MacroAuditPanel } from "./MacroAuditPanel";
import { useSettle } from "./helpers";

const TABS = [
  { value: "trend", label: "写作趋势" },
  { value: "metrics", label: "章节指标" },
  { value: "style", label: "文风指纹" },
  { value: "audit", label: "AI 味体检" },
  { value: "macro", label: "宏观审计" },
];

/** 写作分析页：趋势 / 指标曲线 / 文风指纹 / AI 味体检 / 宏观审计 */
export function InsightsPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const project = useProject(projectId);
  const chapters = useChapters(projectId);
  const settled = useSettle();
  const [tab, setTab] = useState("trend");

  const totalWords = chapters.reduce((a, c) => a + c.wordCount, 0);

  if (!project || !settled) {
    return (
      <PageScaffold title="写作分析" description="正在读取数据…" withNav>
        <Loading label="正在打开分析面板…" />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold title="写作分析" description={chapters.length + " 章 · " + formatWords(totalWords)} withNav>
      <div className="mx-auto max-w-6xl">
        {/*
          标签栏是 Animate UI 的滑动指示器（SlidingTabs）：选中药丸会平滑滑到新标签上，
          白色药丸的底色/阴影/圆角沿用原 HeroUI tabs 的观感，只是不再静态闪现。
        */}
        <SlidingTabs items={TABS} value={tab} onChange={setTab} listClassName="mb-5" ariaLabel="写作分析视角">
          <SlidingTabsPanel value="trend">
            <WritingTrend projectId={projectId} chapters={chapters} />
          </SlidingTabsPanel>
          <SlidingTabsPanel value="metrics">
            <MetricsCurve projectId={projectId} chapters={chapters} />
          </SlidingTabsPanel>
          <SlidingTabsPanel value="style">
            <StyleFingerprintPanel projectId={projectId} chapters={chapters} />
          </SlidingTabsPanel>
          <SlidingTabsPanel value="audit">
            <LocalAuditPanel projectId={projectId} chapters={chapters} />
          </SlidingTabsPanel>
          <SlidingTabsPanel value="macro">
            <MacroAuditPanel projectId={projectId} chapters={chapters} />
          </SlidingTabsPanel>
        </SlidingTabs>
      </div>
    </PageScaffold>
  );
}

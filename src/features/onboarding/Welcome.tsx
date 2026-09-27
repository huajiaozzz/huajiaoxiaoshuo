import { useNavigate } from "react-router-dom";
import { Card } from "@/components/kit";
import { BookOpenCheck, HardDrive, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { Fade } from "@/components/animate-ui/primitives/effects/fade";
import { Shine } from "@/components/animate-ui/primitives/effects/shine";
import { GradientText } from "@/components/animate-ui/primitives/texts/gradient";
import { RippleButton } from "@/components/animate-ui/primitives/buttons/ripple";
import { ROUTES } from "@/app/routes";
import { useProjects } from "@/app/hooks";
import { useAppStore } from "@/app/store";

/**
 * 首次进入的落地页：强调本地私有 + 两个入口。
 *
 * 视觉语言参照「众工速配」原型：hero 是一块**极淡渐变横幅**（rounded-3xl +
 * from-primary/8 的底纹），标题里只有 4 个字是彩色渐变（GradientText）——
 * 全站 95% 仍是黑白灰，彩色只点在最值钱的那句话上，所以不吵。
 * 主按钮是黑色药丸（RippleButton 按下有涟漪），卡片 hover 有一层 Shine 扫光。
 */
export function Welcome() {
  const navigate = useNavigate();
  const projects = useProjects();
  const setNewProjectOpen = useAppStore((s) => s.setNewProjectOpen);
  const hasProjects = (projects?.length ?? 0) > 0;

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto flex min-h-dvh max-w-4xl flex-col justify-center px-6 py-16">
        {/* hero 横幅：渐变只做底纹，几乎看不见，但它让整块不再"平" */}
        <Fade>
          <div className="rounded-3xl border border-border bg-gradient-to-r from-primary/8 via-background to-primary/5 px-8 py-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-black/5 px-3 py-1 text-xs opacity-70 dark:bg-white/10">
              <ShieldCheck className="size-3.5" />
              全部数据存放在你自己的浏览器里
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">
              一句话成书 · <GradientText text="设定不崩" />
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed opacity-70">
              为长篇小说而做的 AI 创作工作台。人物、世界观、伏笔、时间线都是可被 AI
              读取的结构化资产，每次生成都会带上正确的上下文，因此它不会写崩你的设定。
            </p>
          </div>
        </Fade>

        {/* 两张入口卡：hover 扫光（Shine），入场错开 90ms（Fade delay） */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Fade delay={90}>
            <Shine enableOnHover className="h-full rounded-2xl">
              <Card className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
                <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Wand2 className="size-4.5" />
                </div>
                <h2 className="font-semibold tracking-tight">一句话成书</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  给一句灵感，自动产出书名、高概念、人物、世界观、分卷结构与章节大纲，并写成你的项目。
                </p>
                <RippleButton
                  className="mt-4 w-full rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground"
                  hoverScale={1.02}
                  tapScale={0.97}
                  onClick={() => setNewProjectOpen(true)}
                >
                  创建新作品
                </RippleButton>
              </Card>
            </Shine>
          </Fade>

          <Fade delay={180}>
            <Shine enableOnHover className="h-full rounded-2xl">
              <Card className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
                <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                  <BookOpenCheck className="size-4.5" />
                </div>
                <h2 className="font-semibold tracking-tight">
                  {hasProjects ? "继续写作" : "导入已有稿件"}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {hasProjects
                    ? "打开最近的书继续写。所有改动都会即时保存到本地。"
                    : "已有作品？先建一个项目，再把稿件整篇粘进来，系统会自动切分章节并建立设定库。"}
                </p>
                <RippleButton
                  className="mt-4 w-full rounded-full border border-border bg-background px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  hoverScale={1.02}
                  tapScale={0.97}
                  onClick={() => {
                    if (hasProjects) navigate(ROUTES.home);
                    else setNewProjectOpen(true);
                  }}
                >
                  {hasProjects ? "查看我的作品" : "开始创建"}
                </RippleButton>
              </Card>
            </Shine>
          </Fade>
        </div>

        <Fade delay={270}>
          <div className="mt-8 grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="flex items-start gap-2">
              <HardDrive className="mt-0.5 size-3.5 shrink-0" />
              <span>数据存在 IndexedDB，可随时导出为 JSON 备份</span>
            </div>
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-3.5 shrink-0" />
              <span>支持 DeepSeek / OpenAI / Kimi / 智谱 / 本地 Ollama</span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>可一键禁止云端模型，只用本地模型写作</span>
            </div>
          </div>
        </Fade>
      </div>
    </div>
  );
}

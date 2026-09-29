import { Button, Chip } from "@/components/kit";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useAppStore } from "@/app/store";
import { DEFAULT_SETTINGS } from "@/db/repo/settings";
import { CHINESE_FONT_SIZES, EDITOR_FONT_STACK } from "@/app/theme";
import { THEMES, type Theme } from "@/core";
import { resolveAutoExtract } from "@/core";

const THEME_LABEL: Record<Theme, string> = {
  light: "浅色",
  dark: "深色",
  warm: "暖阳",
  soft: "柔彩",
  system: "跟随系统",
};

/** 写作偏好设置：字号、版心宽度、自动保存、快照、心流。 */
export function EditorPreferences() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const notify = useAppStore((s) => s.notify);
  const autoExtract = resolveAutoExtract(settings);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">正文排版</h2>
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs opacity-70">字号</span>
              <span className="tabular text-xs opacity-60">{settings.editorFontSize}px</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                isIconOnly
                size="sm"
                variant="outline"
                onPress={() => updateSettings({ editorFontSize: Math.max(13, settings.editorFontSize - 1) })}
              >
                <Minus className="size-3.5" />
              </Button>
              <input
                type="range"
                min={13}
                max={26}
                value={settings.editorFontSize}
                onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) })}
                className="flex-1 accent-neutral-900"
              />
              <Button
                isIconOnly
                size="sm"
                variant="outline"
                onPress={() => updateSettings({ editorFontSize: Math.min(26, settings.editorFontSize + 1) })}
              >
                <Plus className="size-3.5" />
              </Button>
              <div className="ml-2 flex gap-1">
                {CHINESE_FONT_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => updateSettings({ editorFontSize: s })}
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] transition " +
                      (settings.editorFontSize === s ? "bg-black/[0.07] text-neutral-800 dark:text-neutral-200" : "opacity-50 hover:opacity-90")
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs opacity-70">版心宽度</span>
              <span className="tabular text-xs opacity-60">{settings.editorMaxWidth}px</span>
            </div>
            <input
              type="range"
              min={560}
              max={1100}
              step={20}
              value={settings.editorMaxWidth}
              onChange={(e) => updateSettings({ editorMaxWidth: Number(e.target.value) })}
              className="w-full accent-neutral-900"
            />
            <p className="mt-1 text-[11px] opacity-50">中文正文单行 30~40 字阅读最舒适，约 700~820px。</p>
          </div>

          <div className="rounded-lg border border-black/8 p-3 dark:border-white/10">
            <p className="mb-1 text-[11px] opacity-55">预览效果</p>
            <p
              className="manuscript"
              style={{ fontSize: settings.editorFontSize + "px", maxWidth: Math.min(settings.editorMaxWidth, 520) }}
            >
              她推开那扇门的时候，雪已经停了。屋里没有点灯，只有炭盆里一点暗红在呼吸。
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">自动保存与快照</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-xs opacity-70">
            停止输入后自动保存（毫秒）
            <input
              type="number"
              min={300}
              max={10000}
              step={100}
              value={settings.autosaveMs}
              onChange={(e) => updateSettings({ autosaveMs: Math.max(300, Number(e.target.value) || 1200) })}
              className="tabular mt-1 w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
          <label className="text-xs opacity-70">
            自动快照间隔（分钟，0 关闭）
            <input
              type="number"
              min={0}
              max={120}
              value={settings.snapshotIntervalMin}
              onChange={(e) => updateSettings({ snapshotIntervalMin: Math.max(0, Number(e.target.value) || 0) })}
              className="tabular mt-1 w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">保存后自动抽取</h2>
        <div className="mt-3 space-y-3">
          <ToggleRow
            label="自动识别并入库"
            hint="自动保存后，把新增的人物、世界观、伏笔、时间线抽出来入库；失败时静默跳过，不打断写作"
            value={autoExtract.enabled}
            onChange={(v) => updateSettings({ autoExtract: { ...autoExtract, enabled: v } })}
          />
          <label className="block text-xs opacity-70">
            新增多少字跑一次
            <input
              type="number"
              min={200}
              max={10000}
              step={100}
              value={autoExtract.minNewWords}
              onChange={(e) => updateSettings({ autoExtract: { ...autoExtract, minNewWords: Math.max(200, Number(e.target.value) || 800) } })}
              className="tabular mt-1 w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/15"
            />
          </label>
          <p className="text-[11px] leading-relaxed opacity-50">
            新人物自动建卡（带"自动抽取"标记）、地点组织类名词自动建世界观条目、
            伏笔自动记一笔、出场自动补上。15 分钟内只跑一次；每次调用走正常 AI 计费。
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">写作模式</h2>
        <div className="mt-3 space-y-3">
          <ToggleRow
            label="打字机滚动"
            hint="让光标所在行始终保持在屏幕中间"
            value={settings.typewriterScroll}
            onChange={(v) => updateSettings({ typewriterScroll: v })}
          />
          <ToggleRow
            label="默认进入心流模式"
            hint="打开写作页时自动隐藏所有面板"
            value={settings.flowByDefault}
            onChange={(v) => updateSettings({ flowByDefault: v })}
          />
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">界面</h2>
        <div className="mt-3">
          <p className="mb-2 text-xs opacity-70">主题</p>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => updateSettings({ theme: t })}
                className={
                  "rounded-lg border px-3 py-1.5 text-xs transition " +
                  (settings.theme === t
                    ? "border-black/40 bg-black/[0.05] font-medium"
                    : "border-black/10 hover:border-black/25 dark:border-white/15 dark:hover:border-white/30")
                }
              >
                {THEME_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <h2 className="text-sm font-semibold">快捷键</h2>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {[
            ["⌘ / Ctrl + K", "命令面板"],
            ["⌘ / Ctrl + S", "立即保存"],
            ["⌘ / Ctrl + J", "AI 续写当前章节"],
            ["⌘ / Ctrl + ⇧ + F", "进入 / 退出心流模式"],
            ["⌘ / Ctrl + ⌥ + ↑ ↓", "上一章 / 下一章"],
            ["⌘ / Ctrl + ,", "打开设置"],
            ["Esc", "退出心流模式 / 关闭弹层"],
            ["Shift + ?", "写作台内显示快捷键"],
          ].map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-[11px] dark:bg-white/[0.05]">
              <kbd className="font-mono opacity-80">{k}</kbd>
              <span className="opacity-60">{v}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          onPress={() => {
            // 只重置本页字段 —— 整包 DEFAULT_SETTINGS 会把模型/隐私/创作者档案一起清掉
            updateSettings({
              editorFontSize: DEFAULT_SETTINGS.editorFontSize,
              editorMaxWidth: DEFAULT_SETTINGS.editorMaxWidth,
              autosaveMs: DEFAULT_SETTINGS.autosaveMs,
              snapshotIntervalMin: DEFAULT_SETTINGS.snapshotIntervalMin,
              typewriterScroll: DEFAULT_SETTINGS.typewriterScroll,
              flowByDefault: DEFAULT_SETTINGS.flowByDefault,
            });
            notify("success", "已恢复默认写作偏好");
          }}
        >
          <RotateCcw className="size-3.5" />
          恢复默认
        </Button>
        <Chip size="sm" color="default">
          改动即时生效
        </Chip>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="mt-0.5 block text-[11px] opacity-55">{hint}</span>
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 accent-neutral-900" />
    </label>
  );
}

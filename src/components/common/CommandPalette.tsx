import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, Settings } from "lucide-react";
import { AnimatePresence, type Transition } from "motion/react";
import { Fade } from "@/components/animate-ui/primitives/effects/fade";
import { Zoom } from "@/components/animate-ui/primitives/effects/zoom";
import { ROUTES } from "@/app/routes";
import { useAppStore } from "@/app/store";
import { ROUTE_PAGES } from "@/app/nav";

// ⌘K 是招牌交互：tween + 快出缓收曲线，比 spring 更"快而不跳"。退场比入场更快，收得利落
const ENTER: Transition = { type: "tween", duration: 0.2, ease: [0.16, 1, 0.3, 1] };
const EXIT: Transition = { type: "tween", duration: 0.15, ease: "easeOut" };

/** 命令面板：⌘K 呼出，跳转页面。后续会加入"对当前章节执行 AI 动作"。 */
export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const close = () => useAppStore.getState().setCommandOpen(false);
  const project = useAppStore((s) => s.project);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // 每次打开都重置搜索词与高亮项
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const items = useMemo(() => {
    const id = project?.id ?? "";
    const pages = ROUTE_PAGES.map((p) => ({ label: p.label, to: p.to(id), icon: p.icon }));
    // 设置不在侧栏分组里，单独放进来，否则用命令面板找不到它
    const extras = [
      { label: "设置 · 创作者档案", to: ROUTES.settingsSection("profile"), icon: Settings },
      { label: "设置 · 模型与 AI", to: ROUTES.settingsSection("models"), icon: Settings },
      { label: "设置 · 任务路由", to: ROUTES.settingsSection("routing"), icon: Settings },
      { label: "设置 · 写作偏好", to: ROUTES.settingsSection("editor"), icon: Settings },
      { label: "设置 · 隐私", to: ROUTES.settingsSection("privacy"), icon: Settings },
      { label: "设置 · 数据", to: ROUTES.settingsSection("data"), icon: Settings },
    ];
    return [...pages, ...extras].filter((x) =>
      query ? x.label.toLowerCase().includes(query.toLowerCase()) : true,
    );
  }, [project?.id, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(items.length - 1, a + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      }
      if (e.key === "Enter" && items[active]) {
        e.preventDefault();
        navigate(items[active].to);
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, active, navigate]);

  // 包 AnimatePresence：open 置 false 时先播完退场再卸载，否则弹层瞬间消失。
  // primitive 的 transition 进出共用，退场更快是靠 exit 目标自带的 transition 单独定的
  return (
    // 退场期间先断开交互：淡出时弹层还挂在页面上，再点一下会把一次关闭点成两次动作
    <div className={open ? "" : "pointer-events-none"}>
      <AnimatePresence>
        {open && (
          <Fade
            key="command-palette"
            className="fixed inset-0 z-[500] flex items-start justify-center bg-black/30 pt-[12vh] backdrop-blur-sm"
            onClick={close}
            transition={ENTER}
            exit={{ opacity: 0, transition: EXIT }}
          >
            <Zoom
              initialScale={0.96}
              className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 dark:bg-neutral-900 dark:ring-white/10"
              transition={ENTER}
              exit={{ scale: 0.98, transition: EXIT }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3 dark:border-white/5">
                <Search className="size-4 opacity-40" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  placeholder="搜索页面与命令…"
                  className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                />
                <kbd className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] opacity-60 dark:bg-white/10">ESC</kbd>
              </div>
              <ul className="max-h-80 overflow-y-auto p-2">
                {items.length === 0 && <li className="px-3 py-6 text-center text-sm opacity-50">没有匹配项</li>}
                {items.map((item, i) => (
                  <li key={item.to + item.label}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        navigate(item.to);
                        close();
                      }}
                      className={
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition " +
                        (i === active ? "bg-black/[0.06] dark:bg-white/10" : "")
                      }
                    >
                      <item.icon className="size-4 opacity-60" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {i === active && <CornerDownLeft className="size-3.5 opacity-40" />}
                    </button>
                  </li>
                ))}
              </ul>
            </Zoom>
          </Fade>
        )}
      </AnimatePresence>
    </div>
  );
}

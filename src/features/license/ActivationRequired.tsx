import { Button } from "@heroui/react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/app/routes";
import type { GateStatus } from "@/license/status";

/**
 * 「需要授权」提示：卡住创作入口时显示，一键跳到设置里的「授权激活」页。
 *
 * 只有设备线（授权码）：这里只给一个入口，跳过去填码即可。
 */
export function ActivationRequired({
  gate,
  title = "需要授权后才能创作",
  hint,
}: {
  gate?: GateStatus | null;
  title?: string;
  hint?: string;
}) {
  const navigate = useNavigate();
  const detail = hint ?? gate?.message ?? "填一张授权码激活本机，即可继续创作。";

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs leading-relaxed opacity-70">{detail}</p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <Button size="sm" variant="outline" onPress={() => navigate(ROUTES.settingsSection("license"))}>
              <KeyRound className="mr-1 inline size-3.5" />
              去激活
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

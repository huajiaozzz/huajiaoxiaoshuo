import { useEffect, useState } from "react";
import { licenseGate, type GateStatus } from "@/license/status";

/**
 * 读一次授权汇总判定（licenseGate 是本地计算，不联网），
 * 页面用它在「未激活」时挡住创作入口。
 *
 * 注意：这是**判定**不是状态同步 —— 两条线各自的记录仍然各自维护，
 * 激活/解绑之后调 recheck() 重新算一次即可。
 */
export function useLicenseGateState(): { gate: GateStatus | null; loading: boolean; recheck: () => void } {
  const [gate, setGate] = useState<GateStatus | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    void licenseGate().then((next) => {
      if (alive) setGate(next);
    });
    return () => {
      alive = false;
    };
  }, [nonce]);

  return { gate, loading: gate === null, recheck: () => setNonce((n) => n + 1) };
}

import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, TextField } from "@heroui/react";
import { KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Field, SectionTitle } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import * as repo from "@/db/repo/license";
import { activateDevice, currentDevice, deactivateDevice, heartbeatDevice } from "@/license/device";
import { licenseGate, refreshLicenses, type GateStatus } from "@/license/status";
import { formatExpiry } from "@/license/format";
import { effectiveConnection } from "@/license/defaults";
import type { DeviceLicenseRecord, LicenseConnection, LicenseVerdict } from "@/license/types";
import { EMPTY_CONNECTION } from "@/license/types";

/**
 * 设置 · 授权激活（设备线 / 授权码）。
 *
 * 用户只需要填授权码：接入参数（地址 / 产品 / 密钥）是构建时内置的，界面上不出现输入框。
 * 状态卡固定四项：激活状态 / 到期时间 / 设备名额 / 设备指纹。
 * 「能不能创作」的判定只在 `src/license/status.ts`（未授权卡点是新建作品与 AI 建档）。
 */
export function ActivationPanel() {
  const notify = useAppStore((s) => s.notify);
  const [gate, setGate] = useState<GateStatus | null>(null);
  const [record, setRecord] = useState<DeviceLicenseRecord | undefined>();
  const [verdict, setVerdict] = useState<LicenseVerdict | null>(null);
  const [conn, setConn] = useState<LicenseConnection>(EMPTY_CONNECTION);
  const [licenseKey, setLicenseKey] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState<"activate" | "check" | "deactivate" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    const [row, device, gateStatus] = await Promise.all([repo.getDeviceLicense(), currentDevice(), licenseGate()]);
    setRecord(row);
    setFingerprint(device.fingerprint);
    // 用户只填授权码：接入信息来自内置值（构建时注入）；已激活过就用当初存下来的那份
    setConn(row ? row.connection : effectiveConnection());
    setVerdict(gateStatus.device);
    setGate(gateStatus);
  }, []);

  useEffect(() => {
    void load();
    // 打开授权页顺手核对一次（不到期不会发请求）
    void refreshLicenses();
  }, [load]);

  const onActivate = async () => {
    setBusy("activate");
    setMessage(null);
    try {
      const res = await activateDevice(conn, licenseKey);
      setMessage({ tone: res.ok ? "success" : "danger", text: res.message });
      if (res.ok) {
        setLicenseKey("");
        notify("success", "设备已激活", res.message);
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onCheck = async () => {
    setBusy("check");
    setMessage(null);
    try {
      const res = await heartbeatDevice(true);
      setMessage(
        res
          ? { tone: res.ok ? "success" : "danger", text: res.message }
          : { tone: "danger", text: "本机还没有激活记录，先填授权码激活再来核对" },
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onDeactivate = async () => {
    if (!confirm("解绑本机？这台设备的名额会被释放，之后需要重新激活才能继续创作。")) return;
    setBusy("deactivate");
    setMessage(null);
    try {
      const res = await deactivateDevice();
      setMessage({ tone: res.ok ? "success" : "danger", text: res.message });
      if (res.ok) notify("success", "已解绑本机", res.message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const stateText =
    verdict?.state === "active"
      ? "已激活"
      : verdict?.state === "grace"
        ? "已到期（暂时可继续使用）"
        : verdict?.state === "expired"
          ? "已过期"
          : verdict?.state === "invalid"
            ? "授权无效"
            : verdict?.state === "error"
              ? "暂时无法确认"
              : "未激活";

  return (
    <div className="space-y-5">
      <SectionTitle>授权激活</SectionTitle>

      <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 opacity-60" />
          <p className="text-sm font-medium"><span data-license-status>{stateText}</span></p>
          {record?.licenseFile?.plan && <span className="text-xs opacity-60">套餐 {record.licenseFile.plan}</span>}
        </div>
        <div className="mt-3 space-y-1.5">
          <Field label="激活状态">
            {stateText}
            {verdict && ["grace", "expired", "invalid", "error"].includes(verdict.state) ? (
              <span className="opacity-60"> · {verdict.message}</span>
            ) : null}
          </Field>
          <Field label="到期时间">
            {record?.licenseFile ? formatExpiry(record.licenseFile.expiresAt, record.licenseFile.perpetual) : "—"}
          </Field>
          <Field label="设备名额">
            {record?.licenseFile ? `${record.licenseFile.maxDevices} 台（本机占 1）` : "—"}
          </Field>
          <Field label="设备指纹">
            <span className="font-mono text-xs">{fingerprint || "…"}</span>
          </Field>
        </div>
        {record && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" isPending={busy === "check"} onPress={() => void onCheck()}>
              <RefreshCw className="mr-1 inline size-3.5" />
              立即核对
            </Button>
            <Button size="sm" variant="outline" isPending={busy === "deactivate"} onPress={() => void onDeactivate()}>
              <Trash2 className="mr-1 inline size-3.5" />
              解绑本机
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 opacity-60" />
          <p className="text-sm font-medium">设备激活</p>
        </div>
        <p className="mt-1 text-xs leading-relaxed opacity-60">输入 16 位授权码，形如 LHAB-9F3K-7M2P-XQ4T。</p>
        <div className="mt-4 flex items-end gap-2">
          <TextField value={licenseKey} onChange={setLicenseKey} className="flex-1">
            <Label className="text-xs">授权码</Label>
            <Input placeholder="LHAB-9F3K-7M2P-XQ4T" />
          </TextField>
          <Button isPending={busy === "activate"} onPress={() => void onActivate()}>
            <KeyRound className="mr-1 inline size-3.5" />
            激活本机
          </Button>
        </div>

        {message && (
          <p
            data-license-message
            className={
              "mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed " +
              (message.tone === "success"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-300")
            }
          >
            {message.text}
          </p>
        )}
      </div>

    </div>
  );
}

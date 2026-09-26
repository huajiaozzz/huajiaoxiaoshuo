import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, TextField } from "@heroui/react";
import { Globe, KeyRound, Link2Off, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Field, SectionTitle } from "@/components/common/ui";
import { useAppStore } from "@/app/store";
import * as repo from "@/db/repo/license";
import {
  activateDevice,
  currentDevice,
  deactivateDevice,
  heartbeatDevice,
  installId,
} from "@/license/device";
import {
  activateSiteDomain,
  currentSiteDomain,
  deactivateSiteDomain,
  verifySiteDomain,
} from "@/license/domain";
import { licenseGate, type GateStatus } from "@/license/status";
import { formatExpiry } from "@/license/format";
import { effectiveConnection } from "@/license/defaults";
import type {
  DeviceLicenseRecord,
  DomainLicenseRecord,
  LicenseConnection,
  LicenseVerdict,
} from "@/license/types";
import { EMPTY_CONNECTION } from "@/license/types";

/**
 * 设置 · 授权激活（两条线在同一页，但**逻辑上仍是各自独立的两套**）。
 *
 * 设备线（授权码）：`src/license/device.ts`，把授权码绑到这台设备，界面只让用户填授权码。
 * 域名线（站点）：`src/license/domain.ts`，凭据就是域名本身，用户不用输码。
 * 两条线各有各的记录与激活/校验/解绑；这里只是汇总展示，别把两者的状态串起来用。
 * 判定「能不能创作」只走 `src/license/status.ts`（未授权卡点是新建作品与 AI 建档）。
 */
export function ActivationPanel() {
  const notify = useAppStore((s) => s.notify);
  const [gate, setGate] = useState<GateStatus | null>(null);
  const [deviceRecord, setDeviceRecord] = useState<DeviceLicenseRecord | undefined>();
  const [domainRecord, setDomainRecord] = useState<DomainLicenseRecord | undefined>();
  const [deviceVerdict, setDeviceVerdict] = useState<LicenseVerdict | null>(null);
  const [domainVerdict, setDomainVerdict] = useState<LicenseVerdict | null>(null);
  const [conn, setConn] = useState<LicenseConnection>(EMPTY_CONNECTION);
  const [licenseKey, setLicenseKey] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState<"activate" | "check" | "deactivate" | "activateDomain" | "checkDomain" | "deactivateDomain" | null>(null);
  const [deviceMessage, setDeviceMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [domainMessage, setDomainMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const siteDomain = currentSiteDomain();

  const load = useCallback(async () => {
    const [device, domain] = await Promise.all([repo.getDeviceLicense(), repo.getDomainLicense()]);
    const [dev, verdicts, summary] = await Promise.all([
      currentDevice(),
      Promise.all([import("@/license/device"), import("@/license/domain")]),
      licenseGate(),
    ]);
    setDeviceRecord(device);
    setDomainRecord(domain);
    setFingerprint(dev.fingerprint);
    // 用户只填授权码：接入信息来自内置值（构建时注入）；已激活过就用当初存下来的那份
    setConn(device ? device.connection : domain ? domain.connection : effectiveConnection());
    setDeviceVerdict(await verdicts[0].deviceVerdict());
    setDomainVerdict(await verdicts[1].domainVerdict());
    setGate(summary);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- 设备线动作 ----
  const onActivateDevice = async () => {
    setBusy("activate");
    setDeviceMessage(null);
    try {
      const res = await activateDevice(conn, licenseKey);
      setDeviceMessage({ tone: res.ok ? "success" : "danger", text: res.message });
      if (res.ok) {
        setLicenseKey("");
        notify("success", "设备已激活", res.message);
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onCheckDevice = async () => {
    setBusy("check");
    setDeviceMessage(null);
    try {
      const res = await heartbeatDevice(true);
      setDeviceMessage(
        res
          ? { tone: res.ok ? "success" : "danger", text: res.message }
          : { tone: "danger", text: "本机还没有激活记录，先填授权码激活再来核对" },
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onDeactivateDevice = async () => {
    if (!confirm("解绑本机？这台设备的名额会被释放，之后需要重新激活才能继续创作。")) return;
    setBusy("deactivate");
    setDeviceMessage(null);
    try {
      const res = await deactivateDevice();
      setDeviceMessage({ tone: res.ok ? "success" : "danger", text: res.message });
      if (res.ok) notify("success", "已解绑本机", res.message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  // ---- 域名线动作 ----
  const onActivateDomain = async () => {
    setBusy("activateDomain");
    setDomainMessage(null);
    try {
      const res = await activateSiteDomain(conn, domainInput || undefined);
      setDomainMessage({ tone: res.ok ? "success" : "danger", text: res.message });
      if (res.ok) {
        setDomainInput("");
        notify("success", "域名已激活", res.message);
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onVerifyDomain = async () => {
    setBusy("checkDomain");
    setDomainMessage(null);
    try {
      const res = await verifySiteDomain(true);
      setDomainMessage(
        res
          ? { tone: res.ok ? "success" : "danger", text: res.message }
          : { tone: "danger", text: "还没有域名授权记录，先点「激活当前域名」" },
      );
      await load();
    } finally {
      setBusy(null);
    }
  };

  const onDeactivateDomain = async () => {
    if (!confirm(`解绑 ${domainRecord?.domain ?? siteDomain}？会释放一个域名额度，之后这个域名将不再被授权。`)) return;
    setBusy("deactivateDomain");
    setDomainMessage(null);
    try {
      const res = await deactivateSiteDomain();
      setDomainMessage({ tone: res.ok ? "success" : "danger", text: res.message });
      if (res.ok) notify("success", "已解绑域名", res.message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  // ---- 汇总显示 ----
  const sourceLabel = gate?.source === "device" ? "设备授权码" : gate?.source === "domain" ? "域名授权" : "";
  const statusText = gate?.activated ? `已激活${sourceLabel ? ` · ${sourceLabel}` : ""}` : "未激活";
  const effectiveFile =
    (gate?.source === "domain" ? domainRecord?.licenseFile : deviceRecord?.licenseFile) ??
    deviceRecord?.licenseFile ??
    domainRecord?.licenseFile;

  const lineState = (v: LicenseVerdict | null) =>
    v?.state === "active"
      ? "已激活"
      : v?.state === "grace"
        ? "已到期（宽限期内）"
        : v?.state === "expired"
          ? "已过期"
          : v?.state === "invalid"
            ? "授权无效"
            : v?.state === "error"
              ? "无法判定"
              : "未激活";

  return (
    <div className="space-y-5">
      <SectionTitle hint="两条线任一条有效即可创作：填授权码（本机设备）或按域名开通（网站部署）。">
        授权激活
      </SectionTitle>

      <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 opacity-60" />
          <p className="text-sm font-medium">{statusText}</p>
          {effectiveFile?.plan && <span className="text-xs opacity-60">套餐 {effectiveFile.plan}</span>}
        </div>
        <div className="mt-3 space-y-1.5">
          <Field label="激活状态">
            <span data-license-status>{statusText}</span>
            {!gate?.activated && gate?.message ? <span className="opacity-60"> · {gate.message}</span> : null}
          </Field>
          <Field label="到期时间">
            {effectiveFile ? formatExpiry(effectiveFile.expiresAt, effectiveFile.perpetual) : "—"}
          </Field>
          <Field label="设备名额">
            {deviceRecord?.licenseFile ? `${deviceRecord.licenseFile.maxDevices} 台（本机占 1）` : "—"}
          </Field>
          <Field label="设备指纹">
            <span className="font-mono text-xs">{fingerprint || "…"}</span>
            <span className="ml-2 text-xs opacity-50">（安装 ID {installId().slice(0, 8)}…，换机器 / 清浏览器数据会变）</span>
          </Field>
        </div>
      </div>

      <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 opacity-60" />
          <p className="text-sm font-medium">设备激活（授权码）</p>
          <span className="text-xs opacity-60">{lineState(deviceVerdict)}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed opacity-60">
          输入授权码即可（16 位，形如 LHAB-9F3K-7M2P-XQ4T）。授权服务地址、产品与密钥都由客户端内置，不需要填、也不显示。
        </p>
        <div className="mt-4 flex items-end gap-2">
          <TextField value={licenseKey} onChange={setLicenseKey} className="flex-1">
            <Label className="text-xs">授权码</Label>
            <Input placeholder="LHAB-9F3K-7M2P-XQ4T" />
          </TextField>
          <Button isPending={busy === "activate"} onPress={() => void onActivateDevice()}>
            <KeyRound className="mr-1 inline size-3.5" />
            激活本机
          </Button>
        </div>
        {deviceRecord && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" isPending={busy === "check"} onPress={() => void onCheckDevice()}>
              <RefreshCw className="mr-1 inline size-3.5" />
              立即核对
            </Button>
            <Button size="sm" variant="outline" isPending={busy === "deactivate"} onPress={() => void onDeactivateDevice()}>
              <Trash2 className="mr-1 inline size-3.5" />
              解绑本机
            </Button>
          </div>
        )}
        {deviceMessage && (
          <p
            data-license-device-message
            className={
              "mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed " +
              (deviceMessage.tone === "success"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-300")
            }
          >
            {deviceMessage.text}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
        <div className="flex items-center gap-2">
          <Globe className="size-4 opacity-60" />
          <p className="text-sm font-medium">域名授权（网站部署）</p>
          <span className="text-xs opacity-60">{lineState(domainVerdict)}</span>
        </div>
        <div className="mt-3 space-y-1.5">
          <Field label="当前域名">
            <span className="font-mono text-xs">{siteDomain || "（取不到，可在下面手动填写域名）"}</span>
          </Field>
          <Field label="状态">
            {lineState(domainVerdict)}
            {domainVerdict?.message ? <span className="opacity-60"> · {domainVerdict.message}</span> : null}
          </Field>
          <Field label="到期时间">
            {domainRecord?.licenseFile ? formatExpiry(domainRecord.licenseFile.expiresAt, domainRecord.licenseFile.perpetual) : "—"}
          </Field>
          <Field label="域名额度">
            {domainRecord?.licenseFile ? `${domainRecord.licenseFile.usedDomains}/${domainRecord.licenseFile.maxDomains}` : "—"}
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TextField value={domainInput} onChange={setDomainInput}>
            <Label className="text-xs">要授权的域名（留空 = 当前域名）</Label>
            <Input placeholder={siteDomain || "example.com"} />
          </TextField>
          <Button isPending={busy === "activateDomain"} onPress={() => void onActivateDomain()}>
            <Globe className="mr-1 inline size-3.5" />
            激活当前域名
          </Button>
        </div>
        <p className="mt-2 text-xs opacity-55">域名归一化会自动去掉 www、端口与路径（WWW.Example.com:8443/x → example.com）</p>
        {domainRecord && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" isPending={busy === "checkDomain"} onPress={() => void onVerifyDomain()}>
              <RefreshCw className="mr-1 inline size-3.5" />
              立即校验
            </Button>
            <Button size="sm" variant="outline" isPending={busy === "deactivateDomain"} onPress={() => void onDeactivateDomain()}>
              <Link2Off className="mr-1 inline size-3.5" />
              解绑当前域名
            </Button>
          </div>
        )}
        {domainMessage && (
          <p
            data-license-domain-message
            className={
              "mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed " +
              (domainMessage.tone === "success"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-300")
            }
          >
            {domainMessage.text}
          </p>
        )}
      </div>

      {loaded && !deviceRecord && !domainRecord && (
        <p className="text-xs leading-relaxed opacity-55">
          还没有激活过。拿到授权码填进上面的输入框点「激活本机」即可；设备名额占满了就在 LicenseHub 后台清掉旧设备，
          或让用户在门户自助解绑。网站部署则用下面那块按域名开通。
        </p>
      )}
    </div>
  );
}

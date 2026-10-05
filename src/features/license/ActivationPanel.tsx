import { useCallback, useEffect, useState } from "react";
import { Button, Input, Label, TextField } from "@/components/kit";
import { KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { Field, SectionTitle } from "@/components/common/ui";
import { appConfirm } from "@/components/common/appConfirm";
import { useAppStore } from "@/app/store";
import * as repo from "@/db/repo/license";
import { activateDevice, currentDevice, deactivateDevice } from "@/license/device";
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
  const [busy, setBusy] = useState<"activate" | "deactivate" | null>(null);
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

  const onDeactivate = async () => {
    if (!(await appConfirm("解绑本机？这台设备的名额会被释放，之后需要重新激活才能继续创作。", { title: "解绑本机", danger: true }))) return;
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

      <PriceTable />

      <ContactAuthor />

    </div>
  );
}

/** 联系作者：加微信 / 微信付款 / 支付宝付款（图片点开看大图，扫码更稳） */
const CONTACT_QRS = [
  { src: "/contact/contact-wechat.jpg", label: "加作者微信", hint: "咨询、购买激活码" },
  { src: "/contact/contact-wechat-pay.jpg", label: "微信支付", hint: "付款后请加微信发截图" },
  { src: "/contact/contact-alipay.jpg", label: "支付宝", hint: "付款后请加微信发截图" },
] as const;

function ContactAuthor() {
  return (
    <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
      <p className="text-sm font-medium">联系作者</p>
      <p className="mt-1 text-xs leading-relaxed opacity-60">
        扫码加微信，或直接扫码付款；付完把「付款截图 + 昵称」发给作者，会发来 16 位授权码。
        图片点开可以看大图，扫码更清楚。
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {CONTACT_QRS.map((q) => (
          <a
            key={q.src}
            href={q.src}
            target="_blank"
            rel="noreferrer"
            className="group block"
          >
            <img
              src={q.src}
              alt={q.label}
              loading="lazy"
              className="w-full rounded-lg border border-black/8 transition group-hover:border-black/25 dark:border-white/10 dark:group-hover:border-white/30"
            />
            <p className="mt-1.5 text-xs font-medium">{q.label}</p>
            <p className="text-[11px] opacity-55">{q.hint}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

/** 版本与价格：说清楚每一档给什么、多少钱 */
const PLANS = [
  {
    name: "免费版",
    price: "0 元",
    tag: "普通功能免费",
    highlight: false,
    items: [
      { text: "写作、大纲、设定库、知识页全都能用", ok: true },
      { text: "本地保存、导入导出、备份恢复", ok: true },
      { text: "AI 生成与检查功能", ok: false },
    ],
  },
  {
    name: "Pro 版",
    price: "368 元",
    tag: "全功能无限制",
    highlight: true,
    items: [
      { text: "免费版的全部功能", ok: true },
      { text: "AI 全套：一句话成书、续写、抽取、一致性检查", ok: true },
      { text: "写作记忆 + 语义召回 + 本地模型接入", ok: true },
      { text: "不限字数、不限作品数", ok: true },
    ],
  },
  {
    name: "私有化部署版",
    price: "1688 元",
    tag: "赠送独立授权管理后台",
    highlight: false,
    items: [
      { text: "Pro 版的全部功能", ok: true },
      { text: "部署到你自己的服务器，数据完全自持", ok: true },
      { text: "赠送独立授权管理后台，可自行发卡、管设备", ok: true },
    ],
  },
] as const;

function PriceTable() {
  return (
    <div className="rounded-xl border border-black/8 p-4 dark:border-white/10">
      <p className="text-sm font-medium">版本与价格</p>
      <p className="mt-1 text-xs leading-relaxed opacity-60">
        普通功能永久免费，只有 AI 能力需要激活。一次买断，不订阅。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.name}
            className={
              "flex flex-col rounded-xl border p-3.5 " +
              (p.highlight
                ? "border-black/25 bg-black/[0.04] dark:border-white/25 dark:bg-white/[0.06]"
                : "border-black/8 dark:border-white/10")
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">{p.name}</span>
              {p.highlight && (
                <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-medium text-white dark:bg-white dark:text-black">
                  推荐
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xl font-semibold tracking-tight">{p.price}</p>
            <p className="mt-0.5 text-[11px] opacity-55">{p.tag}</p>
            <ul className="mt-3 space-y-1.5">
              {p.items.map((it) => (
                <li key={it.text} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                  <span className={it.ok ? "opacity-70" : "opacity-30"}>{it.ok ? "✓" : "✕"}</span>
                  <span className={it.ok ? "" : "opacity-45"}>{it.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed opacity-55">
        买之前可以先用免费版写完一本书 —— 没激活也能建项目、写作、保存、导出，只是 AI 生成点不动。
      </p>
    </div>
  );
}

import { APP_VERSION } from "@/core";
import * as repo from "@/db/repo/license";
import { fingerprintFrom, type DeviceInfo } from "./license-client";
import { licenseClientFor, connectionProblem, dueForCheck } from "./client";
import { licenseHint } from "./messages";
import { graceText, describeEntitlements, formatExpiry } from "./format";
import type { DeviceLicenseRecord, LicenseConnection, LicenseVerdict } from "./types";
import { UNACTIVATED } from "./types";

/**
 * 设备授权线（授权码 → 绑定这台设备）。
 *
 * 这条线只管「授权码 + 设备指纹」，与域名授权线没有任何共享状态：
 * 各自的连接配置、各自的记录、各自的判定函数。汇总只发生在 src/license/status.ts。
 */

const INSTALL_ID_KEY = "huajiao:license:installId";
/** 服务端没给 heartbeatIntervalHours 时的默认核对间隔 */
const DEFAULT_HEARTBEAT_HOURS = 24;

/** 安装 ID：首次运行生成一次并持久化；换机器/清掉浏览器数据会变（这属于预期的「新设备」） */
export function installId(): string {
  let id: string | null = null;
  try {
    id = localStorage.getItem(INSTALL_ID_KEY);
  } catch {
    id = null;
  }
  if (!id) {
    id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`;
    try {
      localStorage.setItem(INSTALL_ID_KEY, id);
    } catch {
      /* 无痕模式：本次会话内仍然可用，只是重启后算新设备 */
    }
  }
  return id;
}

function osText(): string {
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "未知系统";
}

function browserText(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "浏览器";
}

/**
 * 设备信息：指纹 = SHA-256(安装 ID + 系统 + 浏览器)。
 * 按官方建议不用 MAC / 硬盘序列号 / IP —— 那些会变，也侵犯隐私。
 */
export async function currentDevice(): Promise<DeviceInfo> {
  const fingerprint = await fingerprintFrom([installId(), osText(), browserText()]);
  return { fingerprint, name: `${browserText()} · ${osText()}`, os: osText(), appVersion: APP_VERSION };
}

export interface DeviceActionResult {
  ok: boolean;
  message: string;
  verdict?: LicenseVerdict;
}

/** 激活：绑定本机并落地签名授权文件（SDK 内部已经验过一次签名） */
export async function activateDevice(conn: LicenseConnection, rawKey: string): Promise<DeviceActionResult> {
  const problem = connectionProblem(conn);
  if (problem) return { ok: false, message: problem };
  const licenseKey = rawKey.trim().toUpperCase();
  if (!licenseKey) return { ok: false, message: "请先填授权码（形如 LHAB-9F3K-7M2P-XQ4T）" };

  const device = await currentDevice();
  const client = licenseClientFor(conn);
  const res = await client.activate(licenseKey, device);
  if (!res.ok) return { ok: false, message: licenseHint(res.reason, res.message) };

  const publicKey = await client.fetchPublicKey();
  const now = new Date().toISOString();
  const record: DeviceLicenseRecord = {
    id: "device",
    kind: "device",
    connection: { baseUrl: conn.baseUrl.trim(), apiKey: conn.apiKey.trim(), product: conn.product.trim() },
    licenseKey,
    accessToken: res.accessToken ?? null,
    licenseFile: res.licenseFile,
    device,
    publicKey,
    lastCheckAt: now,
    lastCheckOk: true,
    lastCheckReason: null,
    heartbeatIntervalHours: res.entitlements?.heartbeatIntervalHours ?? DEFAULT_HEARTBEAT_HOURS,
    createdAt: now,
    updatedAt: now,
  };
  await repo.saveDeviceLicense(record);
  return {
    ok: true,
    message: `激活成功：${describeEntitlements(res.entitlements)}`,
    verdict: await deviceVerdict(),
  };
}

/** 心跳：到期才真的发请求；网络不通时退到本地授权文件 + 宽限期，不锁死用户 */
export async function heartbeatDevice(force = false): Promise<DeviceActionResult | null> {
  const record = await repo.getDeviceLicense();
  if (!record) return null;
  const hours = record.heartbeatIntervalHours ?? DEFAULT_HEARTBEAT_HOURS;
  if (!force && !dueForCheck(record.lastCheckAt, hours)) {
    return { ok: true, message: "授权有效，暂时不用核对", verdict: await deviceVerdict() };
  }

  const client = licenseClientFor(record.connection, record.publicKey);
  const res = await client.verify({
    accessToken: record.accessToken ?? undefined,
    licenseKey: record.licenseKey,
    device: record.device,
  });
  const checkedAt = new Date().toISOString();

  if (res.ok) {
    await repo.saveDeviceLicense({
      ...record,
      lastCheckAt: checkedAt,
      lastCheckOk: res.valid === true,
      lastCheckReason: res.valid ? null : (res.reason ?? null),
      heartbeatIntervalHours: res.heartbeatIntervalHours ?? record.heartbeatIntervalHours,
      publicKey: record.publicKey ?? (await client.fetchPublicKey()),
    });
    return {
      ok: res.valid === true,
      message: res.valid ? "授权有效" : licenseHint(res.reason, res.message),
      verdict: await deviceVerdict(),
    };
  }

  const offlineOnly = res.reason === "network" || res.reason === "timeout";
  await repo.saveDeviceLicense({
    ...record,
    lastCheckAt: offlineOnly ? record.lastCheckAt : checkedAt,
    lastCheckOk: offlineOnly ? record.lastCheckOk : false,
    lastCheckReason: offlineOnly ? record.lastCheckReason : res.reason,
  });
  return {
    ok: false,
    message: offlineOnly
      ? `${licenseHint(res.reason, res.message)}（暂时可以继续使用）`
      : licenseHint(res.reason, res.message),
    verdict: await deviceVerdict(),
  };
}

/** 解绑本机：服务端放行就清本地；纯网络故障则保留记录让用户重试 */
export async function deactivateDevice(): Promise<DeviceActionResult> {
  const record = await repo.getDeviceLicense();
  if (!record) return { ok: false, message: "本机还没有激活记录" };
  const client = licenseClientFor(record.connection, record.publicKey);
  const res = await client.deactivate(record.licenseKey, record.device, "用户在客户端解绑本机");
  if (res.ok) {
    await repo.clearDeviceLicense();
    return { ok: true, message: "已解绑本机，名额已释放" };
  }
  if (res.reason === "network" || res.reason === "timeout") {
    return { ok: false, message: `${licenseHint(res.reason, res.message)}：解绑请求没发出去，本机仍是激活状态，稍后重试` };
  }
  // 服务端明确拒绝（例如授权已被吊销）——本地留着也没意义，清掉
  await repo.clearDeviceLicense();
  return { ok: false, message: `${licenseHint(res.reason, res.message)}；本地激活记录已清除` };
}

/** 本地判定：只读授权文件，不联网（拿不到公钥时才会去抓一次） */
export async function deviceVerdict(): Promise<LicenseVerdict> {
  const record = await repo.getDeviceLicense();
  if (!record || !record.licenseFile) return UNACTIVATED;

  const file = record.licenseFile;
  const client = licenseClientFor(record.connection, record.publicKey);
  let publicKey = record.publicKey;
  if (!publicKey) {
    publicKey = await client.fetchPublicKey();
    if (publicKey) await repo.saveDeviceLicense({ ...record, publicKey });
  }

  const offline = await client.checkOffline(file);
  const common = {
    plan: file.plan,
    expiresAt: file.expiresAt,
    perpetual: file.perpetual,
    features: file.features,
    lastCheckAt: record.lastCheckAt,
    offline: true as const,
  };

  if (!offline.valid) {
    const revoked = record.lastCheckOk === false && record.lastCheckReason
      ? licenseHint(record.lastCheckReason, null)
      : null;
    return {
      ...common,
      activated: false,
      state: offline.reason === "EXPIRED" ? "expired" : offline.reason === "SIGNATURE_INVALID" ? "invalid" : "error",
      message:
        offline.reason === "SIGNATURE_INVALID"
          ? "本地授权文件验签失败（被改过），请重新激活"
          : revoked ?? `授权不可用：${licenseHint(offline.reason, null)}`,
      daysLeft: offline.daysLeft,
    };
  }

  const expired = Boolean(file.expiresAt && Date.now() > new Date(file.expiresAt).getTime());
  return {
    ...common,
    activated: true,
    state: expired ? "grace" : "active",
    message: expired
      ? `本机授权已到期，处于离线宽限期（${graceText(offline.daysLeft, file.offlineGraceDays)}），联网后会自动核对`
      : `设备授权有效 · ${formatExpiry(file.expiresAt, file.perpetual)}`,
    daysLeft: offline.daysLeft,
  };
}

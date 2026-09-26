import { deviceVerdict, heartbeatDevice } from "./device";
import { domainVerdict, verifySiteDomain } from "./domain";
import type { LicenseVerdict } from "./types";

/**
 * 授权判定的唯一汇总点。
 *
 * 两条线各自独立（各自的记录、各自的判定函数、各自的设置页），
 * 这里只做一件事：**回答「能不能创作」这个问题** —— 任一条线有效即放行。
 * 不要在这个文件里做别的合并（比如共用状态、共用配置），那是把两条线揉在一起的开端。
 */

export interface GateStatus {
  /** 能不能创作（任一条线有效） */
  activated: boolean;
  /** 是哪条线在生效 */
  source: "device" | "domain" | null;
  device: LicenseVerdict;
  domain: LicenseVerdict;
  /** 给用户看的一句话（未激活时说明原因） */
  message: string;
}

/**
 * 开发绕行：只在 dev 构建里可能为真。
 *
 * 为什么需要：卡点上线后，本地开发与 20 多个回归脚本就建不了项目了。
 * 为什么安全：生产构建里 `import.meta.env.DEV` 为 false，`if (!false) return false`
 * 恒真 —— 这个函数在线上永远返回 false，用户改 localStorage 也没用（不是后门）。
 */
const DEV_BYPASS_KEY = "huajiao:license:devBypass";

export function devLicenseBypassEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem(DEV_BYPASS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevLicenseBypass(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEV_BYPASS_KEY, "1");
    else localStorage.removeItem(DEV_BYPASS_KEY);
  } catch {
    /* 无痕模式下忽略 */
  }
}

export async function licenseGate(): Promise<GateStatus> {
  const [device, domain] = await Promise.all([deviceVerdict(), domainVerdict()]);
  if (devLicenseBypassEnabled()) {
    return {
      activated: true,
      source: null,
      device,
      domain,
      message: "开发模式：已跳过授权卡点（仅 dev 构建生效）",
    };
  }
  const source: GateStatus["source"] = device.activated ? "device" : domain.activated ? "domain" : null;
  const bothFreshAndIdle = device.state === "unactivated" && domain.state === "unactivated";
  return {
    activated: Boolean(source),
    source,
    device,
    domain,
    message: source
      ? source === "device"
        ? device.message
        : domain.message
      : bothFreshAndIdle
        ? "还没有激活：设备授权码或域名授权，任一条可用即可"
        : device.state !== "unactivated"
          ? device.message
          : domain.message,
  };
}

/**
 * 到期该核对时才发请求（两条线各自判断自己的间隔，互不干扰）。
 * 建议在应用启动、以及打开授权设置页时调用一次。
 */
export async function refreshLicenses(force = false): Promise<void> {
  await Promise.all([
    heartbeatDevice(force).catch(() => null),
    verifySiteDomain(force).catch(() => null),
  ]);
}

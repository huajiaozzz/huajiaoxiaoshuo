import { deviceVerdict, heartbeatDevice } from "./device";
import type { LicenseVerdict } from "./types";

/**
 * 授权判定的唯一汇总点：**只回答「能不能创作」**。
 *
 * 应用当前只接设备线（授权码），所以判定就是设备线判定的结果；
 * 之所以还留这一层，是让卡点与各页面只依赖一个入口，将来要加别的授权方式也只改这里。
 */

export interface GateStatus {
  /** 能不能创作 */
  activated: boolean;
  device: LicenseVerdict;
  /** 给用户看的一句话（未激活时说明原因） */
  message: string;
}

/**
 * 开发绕行：只在 dev 构建里可能为真。
 *
 * 为什么需要：卡点上线后，本地开发与 39 个回归脚本就建不了项目了。
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
  const device = await deviceVerdict();
  if (devLicenseBypassEnabled()) {
    return { activated: true, device, message: "开发模式：已跳过授权卡点（仅 dev 构建生效）" };
  }
  return {
    activated: device.activated,
    device,
    message: device.activated
      ? device.message
      : device.state === "unactivated"
        ? "还没有激活：填一张授权码即可"
        : device.message,
  };
}

/**
 * 到期该核对时才发请求（启动时、以及打开授权设置页时各调一次）。
 * 失败不抛错：判定逻辑自己会退到离线授权文件 + 宽限期。
 */
export async function refreshLicenses(force = false): Promise<void> {
  await heartbeatDevice(force).catch(() => null);
}

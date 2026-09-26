import type { DeviceInfo, LicenseFile } from "./license-client";

/**
 * LicenseHub 连接信息（一个实例的地址 + 接口密钥 + 产品标识）。
 *
 * 值来自构建时注入的默认值（见 `defaults.ts`），**界面上不暴露输入框** ——
 * 用户只需要填一张授权码。
 */
export interface LicenseConnection {
  baseUrl: string;
  apiKey: string;
  product: string;
}

export const EMPTY_CONNECTION: LicenseConnection = { baseUrl: "", apiKey: "", product: "" };

/** 授权是否可用的本地判定结果 */
export interface LicenseVerdict {
  /** 未激活 / 已失效 = false；有效（含宽限期）= true */
  activated: boolean;
  state: "unactivated" | "active" | "grace" | "expired" | "invalid" | "error";
  /** 给用户看的中文说明 */
  message: string;
  /** 离线判定出的剩余天数（可能为负：已过期但在宽限期内） */
  daysLeft?: number;
  plan?: string;
  expiresAt?: string | null;
  perpetual?: boolean;
  features?: string[];
  /** 上次与服务端核对的时间 */
  lastCheckAt?: string | null;
  /** 这次判定是不是退到离线授权文件上做的 */
  offline?: boolean;
}

/**
 * 设备授权（授权码）线的本地状态 —— 应用当前只用这一条线。
 *
 * 落库在 Dexie 表 `licenses`，id 固定为 `"device"`。
 */
export interface DeviceLicenseRecord {
  id: "device";
  kind: "device";
  connection: LicenseConnection;
  /** 用户输入的授权码 */
  licenseKey: string;
  accessToken: string | null;
  licenseFile: LicenseFile | null;
  device: DeviceInfo;
  /** 验签公钥（激活时抓一次存下来，之后离线也能验签） */
  publicKey: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckReason: string | null;
  heartbeatIntervalHours: number | null;
  createdAt: string;
  updatedAt: string;
}

export const UNACTIVATED: LicenseVerdict = {
  activated: false,
  state: "unactivated",
  message: "还没有激活",
};

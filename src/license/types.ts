import type { DeviceInfo, DomainLicenseFile, LicenseFile } from "./license-client";

/**
 * LicenseHub 连接信息（一个实例的地址 + 接口密钥 + 产品标识）。
 *
 * **两条授权线各存一份**，互不影响：设备线改地址不会动域名线。
 * 新建其中一条时，输入框会把另一条已保存的值当作默认值带出来（免得同一个地址打两遍），
 * 但保存、清除、失效判定始终是各管各的。
 */
export interface LicenseConnection {
  baseUrl: string;
  apiKey: string;
  product: string;
}

export const EMPTY_CONNECTION: LicenseConnection = { baseUrl: "", apiKey: "", product: "" };

/** 授权是否可用的本地判定结果（两条线共用同一形状，但各自独立计算） */
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

/** 设备授权（授权码）线的本地状态 */
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

/** 域名授权线的本地状态 */
export interface DomainLicenseRecord {
  id: "domain";
  kind: "domain";
  connection: LicenseConnection;
  /** 激活时用的域名（归一化后的） */
  domain: string;
  accessToken: string | null;
  licenseFile: DomainLicenseFile | null;
  publicKey: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LicenseRecord = DeviceLicenseRecord | DomainLicenseRecord;

export const UNACTIVATED: LicenseVerdict = {
  activated: false,
  state: "unactivated",
  message: "还没有激活",
};

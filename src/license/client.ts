import { LicenseClient } from "./license-client";
import type { LicenseConnection } from "./types";

/**
 * 两条授权线共用的「管道」：造客户端、查连接参数、算该不该核对。
 *
 * 这里刻意只有无状态的工具函数 —— 状态、记录、判定仍然各自归 device.ts / domain.ts，
 * 免得「共用管道」慢慢长成一个把两条线揉在一起的中间层。
 */

export function licenseClientFor(conn: LicenseConnection, publicKey?: string | null): LicenseClient {
  return new LicenseClient({
    baseUrl: conn.baseUrl.trim(),
    apiKey: conn.apiKey.trim(),
    product: conn.product.trim(),
    publicKey: publicKey ?? undefined,
  });
}

/** 连接参数是否填全（缺什么直接说，不要等 fetch 报错） */
export function connectionProblem(conn: LicenseConnection): string | null {
  if (!conn.baseUrl.trim()) return "还没填授权服务地址（LicenseHub 的地址，例如 http://localhost:3000）";
  if (!/^https?:\/\//i.test(conn.baseUrl.trim())) return "授权服务地址要以 http:// 或 https:// 开头";
  if (!conn.apiKey.trim()) return "还没填接口密钥（LicenseHub 后台「接口密钥」里生成的那串）";
  if (!conn.product.trim()) return "还没填产品标识（LicenseHub 里为这个软件建的产品 slug）";
  return null;
}

export function dueForCheck(lastCheckAt: string | null, hours: number): boolean {
  if (!lastCheckAt) return true;
  return Date.now() - new Date(lastCheckAt).getTime() > hours * 3_600_000;
}

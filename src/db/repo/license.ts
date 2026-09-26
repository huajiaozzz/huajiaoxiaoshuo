import { db } from "@/db/database";
import type { DeviceLicenseRecord, DomainLicenseRecord, LicenseRecord } from "@/license/types";

/**
 * 授权状态的读写口（`src/db/repo/*` 是项目唯一的数据入口）。
 *
 * 两条线各占一条记录：id = "device" / "domain"。
 * 这里刻意不提供「读全部」的合并函数 —— 判定各自算，见 src/license/status.ts。
 */

export async function getDeviceLicense(): Promise<DeviceLicenseRecord | undefined> {
  const row = await db.licenses.get("device");
  return row as DeviceLicenseRecord | undefined;
}

export async function saveDeviceLicense(record: DeviceLicenseRecord): Promise<void> {
  await db.licenses.put({ ...record, updatedAt: new Date().toISOString() });
}

export async function clearDeviceLicense(): Promise<void> {
  await db.licenses.delete("device");
}

export async function getDomainLicense(): Promise<DomainLicenseRecord | undefined> {
  const row = await db.licenses.get("domain");
  return row as DomainLicenseRecord | undefined;
}

export async function saveDomainLicense(record: DomainLicenseRecord): Promise<void> {
  await db.licenses.put({ ...record, updatedAt: new Date().toISOString() });
}

export async function clearDomainLicense(): Promise<void> {
  await db.licenses.delete("domain");
}

/** 两条线的原始记录（设置页展示用；不要拿它做「是否已激活」的判断） */
export async function listLicenseRecords(): Promise<LicenseRecord[]> {
  return (await db.licenses.toArray()) as LicenseRecord[];
}

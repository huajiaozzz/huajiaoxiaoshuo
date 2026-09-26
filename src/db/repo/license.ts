import { db } from "@/db/database";
import type { DeviceLicenseRecord } from "@/license/types";

/**
 * 授权状态的读写口（`src/db/repo/*` 是项目唯一的数据入口）。
 *
 * 只有设备（授权码）线，落库在 Dexie 表 `licenses`，id 固定 `"device"`。
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

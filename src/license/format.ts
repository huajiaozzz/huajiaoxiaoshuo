import type { Entitlements } from "./license-client";

/** 到期时间 → 人话（perpetual 显示「永久」） */
export function formatExpiry(expiresAt: string | null | undefined, perpetual?: boolean): string {
  if (perpetual) return "永久有效";
  if (!expiresAt) return "无到期时间";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return String(expiresAt);
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const text = date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  if (days > 0) return `${text}（还剩 ${days} 天）`;
  if (days === 0) return `${text}（今天到期）`;
  return `${text}（已过期 ${-days} 天）`;
}

/** 一句话概括授权内容：套餐 / 到期 / 设备或域名额度 */
export function describeEntitlements(ent: Entitlements | null | undefined): string {
  if (!ent) return "";
  const parts: string[] = [];
  if (ent.plan) parts.push(`套餐 ${ent.plan}`);
  parts.push(formatExpiry(ent.expiresAt ?? null, ent.perpetual));
  if (typeof ent.maxDomains === "number") parts.push(`域名 ${ent.domainCount ?? 0}/${ent.maxDomains}`);
  else if (typeof ent.maxDevices === "number") parts.push(`设备 ${ent.activeDevices ?? 0}/${ent.maxDevices}`);
  if (ent.features?.length) parts.push(`功能点 ${ent.features.join("、")}`);
  return parts.join(" · ");
}

/** 「还剩多少天 / 已进宽限期」：两条线共用的措辞，免得两处说法不一致 */
export function graceText(daysLeft: number | undefined, offlineGraceDays: number | null | undefined): string {
  if (daysLeft === undefined) return "";
  if (daysLeft > 0) return `还剩 ${daysLeft} 天`;
  const grace = offlineGraceDays ?? 0;
  return `已到期，在离线宽限期内（共 ${grace} 天）`;
}

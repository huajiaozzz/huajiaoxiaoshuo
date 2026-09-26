import * as repo from "@/db/repo/license";
import { normalizeDomainClient, verifyDomainFile, type DomainLicenseFile } from "./license-client";
import { licenseClientFor, connectionProblem, dueForCheck } from "./client";
import { licenseHint } from "./messages";
import { describeEntitlements, formatExpiry, graceText } from "./format";
import type { DomainLicenseRecord, LicenseConnection, LicenseVerdict } from "./types";
import { UNACTIVATED } from "./types";

/**
 * 域名授权线（域名本身即凭据，用户不用输任何码）。
 *
 * 与设备线的区别（也是两条线不能合并的原因）：
 * - 凭据是「当前站点的域名」，不是一串码；
 * - 校验要带缓存（官方建议 1~24 小时），否则等于给自己服务器加压力；
 * - 拿不到授权服务时按本地缓存的授权文件 + 宽限期降级，绝不立刻停用。
 */

/** 域名校验缓存小时数：这段时间内直接用上次结果，不打扰服务端 */
const CACHE_HOURS = 6;

/** 当前站点域名（浏览器里就是 location.host 归一化后的样子） */
export function currentSiteDomain(): string {
  return normalizeDomainClient(window.location.host);
}

/** 授权文件里的域名是否覆盖某个主机名（允许子域时 *.example.com 也算） */
export function domainCovers(file: DomainLicenseFile, host: string): boolean {
  const base = normalizeDomainClient(file.domain);
  const target = normalizeDomainClient(host);
  if (!base || !target) return false;
  if (target === base) return true;
  return Boolean(file.allowSubdomains) && target.endsWith("." + base);
}

export interface DomainActionResult {
  ok: boolean;
  message: string;
  verdict?: LicenseVerdict;
}

/** 激活当前域名：用户在 LicenseHub 后台为这个域名开通授权后，这里一次点击即可绑定 */
export async function activateSiteDomain(conn: LicenseConnection, domainInput?: string): Promise<DomainActionResult> {
  const problem = connectionProblem(conn);
  if (problem) return { ok: false, message: problem };

  const domain = normalizeDomainClient(domainInput?.trim() || window.location.host);
  if (!domain) return { ok: false, message: "拿不到当前域名，请手动填写要授权的域名（例如 example.com）" };

  const client = licenseClientFor(conn);
  const res = await client.activateDomain(domain, {
    environment: import.meta.env.PROD ? "production" : "development",
    userAgent: navigator.userAgent,
  });
  if (!res.ok) return { ok: false, message: licenseHint(res.reason, res.message) };

  const publicKey = await client.fetchPublicKey();
  const now = new Date().toISOString();
  const record: DomainLicenseRecord = {
    id: "domain",
    kind: "domain",
    connection: { baseUrl: conn.baseUrl.trim(), apiKey: conn.apiKey.trim(), product: conn.product.trim() },
    domain: res.domain ?? domain,
    accessToken: res.accessToken ?? null,
    licenseFile: res.licenseFile,
    publicKey,
    lastCheckAt: now,
    lastCheckOk: true,
    lastCheckReason: null,
    createdAt: now,
    updatedAt: now,
  };
  await repo.saveDomainLicense(record);
  return {
    ok: true,
    message: `域名 ${record.domain} 激活成功：${describeEntitlements(res.entitlements)}`,
    verdict: await domainVerdict(),
  };
}

/** 域名校验：缓存期内直接返回本地结论；过期或 force 才真的发请求 */
export async function verifySiteDomain(force = false): Promise<DomainActionResult | null> {
  const record = await repo.getDomainLicense();
  if (!record) return null;
  const domain = currentSiteDomain() || record.domain;
  if (!force && !dueForCheck(record.lastCheckAt, CACHE_HOURS)) {
    return { ok: true, message: `缓存期内（${CACHE_HOURS} 小时内已核对过）`, verdict: await domainVerdict() };
  }

  const client = licenseClientFor(record.connection, record.publicKey);
  const res = await client.verifyDomain({ domain, accessToken: record.accessToken ?? undefined, userAgent: navigator.userAgent });
  const checkedAt = new Date().toISOString();

  if (res.ok) {
    await repo.saveDomainLicense({
      ...record,
      domain,
      lastCheckAt: checkedAt,
      lastCheckOk: res.valid === true,
      lastCheckReason: res.valid ? null : (res.reason ?? null),
      publicKey: record.publicKey ?? (await client.fetchPublicKey()),
    });
    return {
      ok: res.valid === true,
      message: res.valid ? "域名授权有效" : licenseHint(res.reason, res.message),
      verdict: await domainVerdict(),
    };
  }

  const offlineOnly = res.reason === "network" || res.reason === "timeout";
  await repo.saveDomainLicense({
    ...record,
    lastCheckAt: offlineOnly ? record.lastCheckAt : checkedAt,
    lastCheckOk: offlineOnly ? record.lastCheckOk : false,
    lastCheckReason: offlineOnly ? record.lastCheckReason : res.reason,
  });
  return {
    ok: false,
    message: offlineOnly
      ? `${licenseHint(res.reason, res.message)}（按本地授权文件与宽限期继续放行）`
      : licenseHint(res.reason, res.message),
    verdict: await domainVerdict(),
  };
}

/** 解绑当前域名：释放一个域名额度（换域名时用） */
export async function deactivateSiteDomain(): Promise<DomainActionResult> {
  const record = await repo.getDomainLicense();
  if (!record) return { ok: false, message: "还没有域名授权记录" };
  if (!record.accessToken) return { ok: false, message: "本地没有解绑所需的访问令牌，请重新激活后再试" };

  const client = licenseClientFor(record.connection, record.publicKey);
  const res = await client.deactivateDomain(record.domain, record.accessToken, "用户在客户端解绑域名");
  if (res.ok) {
    await repo.clearDomainLicense();
    return { ok: true, message: `已解绑 ${record.domain}（当前域名额度 ${res.domainCount}）` };
  }
  if (res.reason === "network" || res.reason === "timeout") {
    return { ok: false, message: `${licenseHint(res.reason, res.message)}：解绑请求没发出去，本地记录保留，稍后重试` };
  }
  await repo.clearDomainLicense();
  return { ok: false, message: `${licenseHint(res.reason, res.message)}；本地域名授权记录已清除` };
}

/** 本地判定：验签 + 到期 + 域名归属，三步都不联网（缺公钥时才抓一次） */
export async function domainVerdict(): Promise<LicenseVerdict> {
  const record = await repo.getDomainLicense();
  if (!record || !record.licenseFile) return UNACTIVATED;

  const file = record.licenseFile;
  const client = licenseClientFor(record.connection, record.publicKey);
  let publicKey = record.publicKey;
  if (!publicKey) {
    publicKey = await client.fetchPublicKey();
    if (publicKey) await repo.saveDomainLicense({ ...record, publicKey });
  }

  const common = {
    plan: file.plan,
    expiresAt: file.expiresAt,
    perpetual: file.perpetual,
    features: file.features,
    lastCheckAt: record.lastCheckAt,
    offline: true as const,
  };

  if (!publicKey || !(await verifyDomainFile(file, publicKey))) {
    return { ...common, activated: false, state: "invalid", message: "本地域名授权文件验签失败（被改过），请重新激活" };
  }

  const host = currentSiteDomain();
  if (host && !domainCovers(file, host)) {
    return {
      ...common,
      activated: false,
      state: "invalid",
      message: `当前域名 ${host} 不在授权范围内（授权的是 ${file.domain}${file.allowSubdomains ? " 及其子域" : ""}）`,
    };
  }

  const expires = file.perpetual || !file.expiresAt ? null : new Date(file.expiresAt).getTime();
  const graceMs = file.offlineGraceDays * 86_400_000;
  const now = Date.now();
  if (expires !== null && now > expires + graceMs) {
    return {
      ...common,
      activated: false,
      state: "expired",
      daysLeft: Math.ceil((expires - now) / 86_400_000),
      message: `域名授权已过期（宽限期 ${file.offlineGraceDays} 天也过了），续期后自动恢复`,
    };
  }

  const inGrace = expires !== null && now > expires;
  return {
    ...common,
    activated: true,
    state: inGrace ? "grace" : "active",
    daysLeft: expires === null ? undefined : Math.ceil((expires - now) / 86_400_000),
    message: inGrace
      ? `域名授权已到期，处于宽限期（${graceText(Math.ceil(((expires as number) - now) / 86_400_000), file.offlineGraceDays)}）`
      : `域名 ${file.domain} 已授权 · ${formatExpiry(file.expiresAt, file.perpetual)}`,
  };
}

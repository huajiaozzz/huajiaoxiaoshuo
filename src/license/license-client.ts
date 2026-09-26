/**
 * LicenseHub 客户端 SDK（零依赖，浏览器 / Node 18+ / Electron / Tauri 通用）。
 *
 * 来源：https://github.com/qw1295353129/huajiao-license-hub/blob/main/sdk/license-client.ts
 * 取回日期：2026-09-27。
 *
 * **与上游的差异**（同步上游时先 diff 这三处）：
 * 1. `base64UrlToBytes` 去掉 Node 的 Buffer 兜底，并把返回类型写成 `Uint8Array<ArrayBuffer>`
 *    —— 本项目跑在浏览器 / WebView 里，atob 一定存在，也不需要 Node 类型；
 * 2. `LicenseClient` 不用构造函数参数属性（`constructor(private readonly x)`）——
 *    项目开了 `erasableSyntaxOnly`，参数属性不是可擦除语法；
 * 3. 其余逻辑与上游逐行一致。
 *
 * 设计要点（上游注释）：
 * 1. 只用 fetch + WebCrypto，不引入任何运行时依赖；
 * 2. 授权文件用 Ed25519 验签，**离线也能判定有效性**（把公钥内置或首次联网缓存）；
 * 3. 网络不可用时返回 { valid: false, reason: 'network' } 而不是抛异常，方便调用方做宽限期降级。
 */

export interface LicenseClientOptions {
  baseUrl: string;
  apiKey: string;
  product: string;
  /** 内置公钥（base64url, SPKI）；不填则首次调用时从服务端拉取并缓存 */
  publicKey?: string;
  /** 自定义 fetch（Electron 主进程 / 代理场景） */
  fetchImpl?: typeof fetch;
  /** 请求超时（毫秒），默认 10s */
  timeoutMs?: number;
}

export interface DeviceInfo {
  fingerprint: string;
  name?: string;
  os?: string;
  appVersion?: string;
}

export interface LicenseFile {
  v: 1;
  kid: string;
  licenseId: string;
  product: string;
  plan: string;
  customer: string | null;
  issuedAt: string;
  validFrom: string;
  expiresAt: string | null;
  perpetual: boolean;
  features: string[];
  maxDevices: number;
  deviceFingerprint: string | null;
  offlineGraceDays: number;
  remainingUsages: number | null;
  nonce: string;
  sig: string;
}

/** 域名授权的授权文件（type 为 'domain'） */
export interface DomainLicenseFile {
  v: 1;
  kid: string;
  type: 'domain';
  domainLicenseId: string;
  product: string;
  plan: string;
  customer: string | null;
  domain: string;
  allowSubdomains: boolean;
  issuedAt: string;
  validFrom: string;
  expiresAt: string | null;
  perpetual: boolean;
  features: string[];
  maxDomains: number;
  usedDomains: number;
  offlineGraceDays: number;
  nonce: string;
  sig: string;
}

/** 用公钥验证域名授权文件（与服务端同一套规范化规则）；必须是 type==='domain' 的文件 */
export async function verifyDomainFile(file: DomainLicenseFile, publicKeyBase64Url: string): Promise<boolean> {
  // 类型混淆防护：设备授权文件不能当域名文件验签
  if (file.type !== 'domain') return false;
  const { sig, ...payload } = file;
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey('spki', base64UrlToBytes(publicKeyBase64Url), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, base64UrlToBytes(sig), new TextEncoder().encode(canonicalize(payload)));
  } catch {
    return false;
  }
}

export interface Entitlements {
  valid: boolean;
  reason?: string;
  message?: string;
  licenseId?: string;
  product?: string;
  plan?: string;
  expiresAt?: string | null;
  perpetual?: boolean;
  features?: string[];
  maxDevices?: number;
  activeDevices?: number;
  /** 已绑定域名数 / 域名额度 */
  domainCount?: number;
  maxDomains?: number;
  domain?: string | null;
  remainingUsages?: number | null;
  heartbeatIntervalHours?: number;
  offlineGraceDays?: number;
}

export type ClientResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: string; message: string; status?: number };

interface RawLicenseFile extends LicenseFile {}

/** 规范化 JSON：键按字典序、无空白 —— 与服务端签名规则一致。 */
export function canonicalize(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, sort(v)]),
      );
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 离线验签：只用公开信息即可判断授权文件是否被篡改；拒绝 type==='domain' 的域名文件。 */
export async function verifyLicenseFile(file: RawLicenseFile, publicKeyBase64Url: string): Promise<boolean> {
  // 类型混淆防护：域名授权文件（type==='domain'）不走设备授权验签路径
  if ((file as { type?: string }).type === 'domain') return false;
  const { sig, ...payload } = file;
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      base64UrlToBytes(publicKeyBase64Url),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      base64UrlToBytes(sig),
      new TextEncoder().encode(canonicalize(payload)),
    );
  } catch {
    return false;
  }
}

export class LicenseClient {
  private cachedKey: string | null;
  /** kid → publicKey 全量映射（含轮换前的历史公钥），来自 /public-key 的 keys[] */
  private cachedKeys: Map<string, string> | null = null;
  private readonly doFetch: typeof fetch;
  private readonly options: LicenseClientOptions;

  constructor(options: LicenseClientOptions) {
    this.options = options;
    this.cachedKey = options.publicKey ?? null;
    this.doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(path: string, body?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<ClientResult<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await this.doFetch(this.options.baseUrl.replace(/\/$/, '') + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.options.apiKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          reason: String(data.code ?? 'HTTP_' + response.status),
          message: String(data.message ?? response.statusText),
        };
      }
      return { ok: true, ...(data as T) };
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      return {
        ok: false,
        reason: aborted ? 'timeout' : 'network',
        message: aborted ? '请求超时' : '无法连接授权服务（离线或网络异常）',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 拉取并缓存验签公钥（含 keys[] 全量 kid 映射）。 */
  async fetchPublicKey(): Promise<string | null> {
    if (this.cachedKey) return this.cachedKey;
    await this.loadKeyMap();
    return this.cachedKey;
  }

  /** 从 /public-key 响应缓存 current + keys[] 全量映射（失败时保留已有内置/缓存键）。 */
  private async loadKeyMap(): Promise<void> {
    if (this.cachedKeys) return;
    const res = await this.request<{
      current: { kid: string; publicKey: string } | null;
      keys?: Array<{ kid: string; publicKey: string }>;
    }>('/api/v1/public-key', undefined, 'GET');
    if (!res.ok || !res.current) return;
    const map = new Map<string, string>();
    for (const entry of res.keys ?? []) {
      if (entry && typeof entry.kid === 'string' && typeof entry.publicKey === 'string') {
        map.set(entry.kid, entry.publicKey);
      }
    }
    const current = res.current;
    if (typeof current.kid === 'string' && typeof current.publicKey === 'string' && !map.has(current.kid)) {
      map.set(current.kid, current.publicKey);
    }
    if (map.size > 0) this.cachedKeys = map;
    if (!this.cachedKey && typeof current.publicKey === 'string') this.cachedKey = current.publicKey;
  }

  /** 按文件 kid 选验签公钥：优先 keys[kid]，回退 current/内置；拉不到且无内置键则返回 null。 */
  private async resolveKeyForKid(kid?: string): Promise<string | null> {
    if (kid && this.cachedKeys?.has(kid)) return this.cachedKeys.get(kid)!;
    if (!this.cachedKeys) await this.loadKeyMap();
    if (kid && this.cachedKeys?.has(kid)) return this.cachedKeys.get(kid)!;
    return this.cachedKey;
  }

  /** 激活：绑定设备并拿回签名授权文件。 */
  async activate(licenseKey: string, device: DeviceInfo): Promise<ClientResult<{
    licenseFile: LicenseFile;
    entitlements: Entitlements;
    accessToken: string;
  }>> {
    const res = await this.request<{ licenseFile: LicenseFile; entitlements: Entitlements; accessToken: string }>(
      '/api/v1/activate',
      { licenseKey, product: this.options.product, device },
    );
    if (res.ok) {
      const key = await this.resolveKeyForKid(res.licenseFile.kid);
      if (!key) return { ok: false, reason: 'NO_PUBLIC_KEY', message: '无法获取验签公钥，拒绝接受授权文件' };
      if (!(await verifyLicenseFile(res.licenseFile, key))) {
        return { ok: false, reason: 'SIGNATURE_INVALID', message: '授权文件验签失败，请勿使用被篡改的文件' };
      }
    }
    return res;
  }

  /** 心跳：优先用 accessToken（快路径），失败自动回退授权码。 */
  async verify(params: { licenseKey?: string; accessToken?: string; device: DeviceInfo }): Promise<ClientResult<{ valid: boolean } & Entitlements>> {
    return this.request('/api/v1/verify', {
      ...(params.licenseKey ? { licenseKey: params.licenseKey } : {}),
      ...(params.accessToken ? { accessToken: params.accessToken } : {}),
      device: params.device,
    });
  }

  async deactivate(licenseKey: string, device: DeviceInfo, reason?: string): Promise<ClientResult<{ valid: boolean }>> {
    return this.request('/api/v1/deactivate', { licenseKey, device, ...(reason ? { reason } : {}) });
  }

  async trial(device: DeviceInfo, email?: string): Promise<ClientResult<{ licenseFile: LicenseFile; entitlements: Entitlements; trial: { days: number; licenseKey: string } }>> {
    return this.request('/api/v1/trial', { product: this.options.product, device, ...(email ? { email } : {}) });
  }

  /* ---------------- 域名授权（Web 应用 / 插件 / SaaS，无需授权码） ---------------- */

  /**
   * 域名激活：把当前站点域名绑定的授权取回来。
   * 域名本身即凭据 —— 客户在服务商后台开通域名授权后，这里只需传域名。
   */
  async activateDomain(
    domain: string,
    options?: { environment?: 'production' | 'staging' | 'development'; userAgent?: string },
  ): Promise<ClientResult<{ licenseFile: DomainLicenseFile; entitlements: Entitlements; accessToken: string; domain: string }>> {
    const res = await this.request<{
      licenseFile: DomainLicenseFile;
      entitlements: Entitlements;
      accessToken: string;
      domain: string;
    }>('/api/v1/domain/activate', {
      domain,
      product: this.options.product,
      ...(options?.environment ? { environment: options.environment } : {}),
      ...(options?.userAgent ? { userAgent: options.userAgent } : {}),
    });
    if (res.ok) {
      const key = await this.resolveKeyForKid(res.licenseFile.kid);
      if (!key) return { ok: false, reason: 'NO_PUBLIC_KEY', message: '无法获取验签公钥，拒绝接受域名授权文件' };
      if (!(await verifyDomainFile(res.licenseFile, key))) {
        return { ok: false, reason: 'SIGNATURE_INVALID', message: '域名授权文件验签失败' };
      }
    }
    return res;
  }

  /** 域名心跳：建议服务端每次请求（带缓存）或每日定时调用。 */
  async verifyDomain(params: { domain: string; accessToken?: string; userAgent?: string }): Promise<ClientResult<{ valid: boolean } & Entitlements>> {
    return this.request('/api/v1/domain/verify', {
      domain: params.domain,
      ...(params.accessToken ? { accessToken: params.accessToken } : {}),
      ...(params.userAgent ? { userAgent: params.userAgent } : {}),
    });
  }

  /**
   * 域名解绑（换域名时用，释放一个额度）。
   * accessToken 必填：服务端 C3 要求持 activate 签发的 domain-client 令牌。
   */
  async deactivateDomain(
    domain: string,
    accessToken: string,
    reason?: string,
  ): Promise<ClientResult<{ valid: boolean; domainCount: number }>> {
    return this.request('/api/v1/domain/deactivate', {
      domain,
      accessToken,
      ...(reason ? { reason } : {}),
    });
  }

  async requestOffline(device: DeviceInfo, licenseKey?: string): Promise<ClientResult<{ requestCode: string }>> {
    return this.request('/api/v1/offline/request', {
      product: this.options.product,
      device,
      ...(licenseKey ? { licenseKey } : {}),
    });
  }

  async activateOffline(responseCode: string): Promise<ClientResult<{ licenseFile: LicenseFile }>> {
    const res = await this.request<{ licenseFile: LicenseFile }>('/api/v1/offline/activate', { responseCode });
    if (res.ok) {
      const key = await this.resolveKeyForKid(res.licenseFile.kid);
      if (!key) return { ok: false, reason: 'NO_PUBLIC_KEY', message: '无法获取验签公钥，拒绝接受响应码授权文件' };
      if (!(await verifyLicenseFile(res.licenseFile, key))) {
        return { ok: false, reason: 'SIGNATURE_INVALID', message: '响应码验签失败' };
      }
    }
    return res;
  }

  /** 纯离线判断：不联网，直接用授权文件 + 内置公钥判断当前是否可用。 */
  async checkOffline(file: LicenseFile, now = Date.now()): Promise<{ valid: boolean; reason?: string; daysLeft?: number }> {
    const key = this.cachedKeys?.get(file.kid) ?? this.cachedKey ?? (await this.fetchPublicKey());
    if (!key) return { valid: false, reason: 'NO_PUBLIC_KEY' };
    if (!(await verifyLicenseFile(file, key))) return { valid: false, reason: 'SIGNATURE_INVALID' };
    if (file.perpetual || !file.expiresAt) return { valid: true };
    const expires = new Date(file.expiresAt).getTime();
    const graceMs = file.offlineGraceDays * 86_400_000;
    const daysLeft = Math.ceil((expires - now) / 86_400_000);
    if (now > expires + graceMs) return { valid: false, reason: 'EXPIRED', daysLeft };
    return { valid: true, daysLeft };
  }
}

/**
 * 服务端集成用：从请求头推断当前站点域名（Host / X-Forwarded-Host），并归一化。
 * 例：Express/Nest 里传 req.headers 即可。
 */
export function currentDomainFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  // host 优先（直连更可信），仅在缺失时才回退到可伪造的 x-forwarded-host
  const raw = headers.host ?? headers['x-forwarded-host'] ?? headers[':authority'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizeDomainClient(value ?? '');
}

/** 与服务端一致的域名归一化（去协议/端口/路径/大小写/www，IDN 转 punycode）。 */
export function normalizeDomainClient(raw: string): string {
  const input = raw.trim().toLowerCase();
  if (!input) return '';
  try {
    const url = new URL(input.includes('://') ? input : 'http://' + input);
    return url.hostname.replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 生成设备指纹的参考实现：把稳定硬件/安装标识哈希后取前 32 位十六进制。
 * 注意：不要用 MAC 地址等会变的字段；安装 ID 建议首次运行生成并持久化。
 */
export async function fingerprintFrom(parts: string[]): Promise<string> {
  const data = new TextEncoder().encode(parts.join('|'));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

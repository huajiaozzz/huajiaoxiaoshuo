import type { LicenseConnection } from "@/license/types";

/**
 * LicenseHub 接入默认值（内置，用户不需要知道这些）。
 *
 * 三者都可以在**构建时**覆盖（`.env.local` 或 CI 环境变量）：
 *   VITE_LICENSE_HUB_URL / VITE_LICENSE_HUB_PRODUCT / VITE_LICENSE_API_KEY
 * 仓库里不放真实密钥 —— 打包发布时用环境变量注入即可。
 *
 * 作者侧的选择：这个网页版是自用/内网优先，密钥随构建注入、用户只填授权码；
 * 若哪天要公开部署给外部用户，把授权请求挪到服务端代理，别让密钥躺在浏览器里。
 */
export const DEFAULT_LICENSE_HUB = {
  baseUrl: (import.meta.env.VITE_LICENSE_HUB_URL as string | undefined)?.trim() || "https://shouquan.reshui.xin",
  product: (import.meta.env.VITE_LICENSE_HUB_PRODUCT as string | undefined)?.trim() || "xiaoshuo",
  apiKey: (import.meta.env.VITE_LICENSE_API_KEY as string | undefined)?.trim() || "",
} as const;

/** 内置值（地址 + 产品）始终可用；密钥可能来自构建环境变量 */
export function hasBuiltInConnection(): boolean {
  return Boolean(DEFAULT_LICENSE_HUB.baseUrl && DEFAULT_LICENSE_HUB.product);
}

/**
 * 开发/测试用的连接参数覆盖（**仅 dev 构建**）。
 *
 * 界面上已经没有接入信息输入框（用户只填授权码），那自动化回归怎么把请求指向本地 LicenseHub？
 * 靠这个：脚本用 addInitScript 往 localStorage 塞一份 JSON 就行。
 * 生产构建里 `import.meta.env.DEV` 为 false，整段会被摇掉（dist 里搜不到这个 key）。
 */
const DEV_CONN_KEY = "huajiao:license:devConn";

export function effectiveConnection(): LicenseConnection {
  if (import.meta.env.DEV) {
    try {
      const raw = localStorage.getItem(DEV_CONN_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LicenseConnection>;
        return {
          baseUrl: (parsed.baseUrl ?? DEFAULT_LICENSE_HUB.baseUrl).trim(),
          product: (parsed.product ?? DEFAULT_LICENSE_HUB.product).trim(),
          apiKey: (parsed.apiKey ?? DEFAULT_LICENSE_HUB.apiKey).trim(),
        };
      }
    } catch {
      /* 坏数据就当没有 */
    }
  }
  return { ...DEFAULT_LICENSE_HUB };
}

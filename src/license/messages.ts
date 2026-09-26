/**
 * 错误码 → 中文说明。
 *
 * 照抄 docs/CLIENT-INTEGRATION.md 第 5 节「错误码与处理建议」，
 * 目的只有一个：**不让用户看到 API_KEY_INVALID 这种字符串**，
 * 而是直接告诉他该干什么（改密钥 / 去解绑 / 等一会儿重试）。
 */
const HINTS: Record<string, string> = {
  VALIDATION_FAILED: "参数不对：检查域名格式、设备指纹或产品标识。",
  API_KEY_INVALID: "接口密钥不对 —— 这是接入方的配置问题，不是授权码的问题，请检查设置里的 API Key。",
  UNAUTHENTICATED: "登录令牌已过期，请重新输入授权码激活。",
  SCOPE_MISSING: "这条接口密钥没勾对应作用域，去 LicenseHub 后台给它补勾。",
  DEVICE_BLACKLISTED: "这台设备已被封禁，请联系客服。",
  LICENSE_NOT_FOUND: "授权码不存在（域名线则是「该域名还没开通授权」）。",
  DOMAIN_NOT_AUTHORIZED: "这个域名还没有被授权，请先在 LicenseHub 后台开通。",
  DEVICE_LIMIT_REACHED: "设备数已满：先在用户门户自助解绑旧设备，或让对方在后台清空设备绑定。",
  DOMAIN_LIMIT_REACHED: "域名额度已满：先解绑不用的域名。",
  DOMAIN_ALREADY_AUTHORIZED: "这个域名已经被另一张授权占用了。",
  TRIAL_ALREADY_USED: "这台设备已经领过试用了。",
  LICENSE_EXPIRED: "授权已到期，续期后即可继续创作。",
  LICENSE_REVOKED: "授权已被吊销，请联系客服。",
  LICENSE_SUSPENDED: "授权已被暂停，请联系客服。",
  RATE_LIMITED: "请求太频繁被限流了，稍等一会儿再试（不要连着点）。",
  SIGNATURE_INVALID: "授权文件验签失败：文件被改动过，拒绝使用。",
  NO_PUBLIC_KEY: "拿不到验签公钥：先联网激活一次，之后断网也能用。",
  timeout: "授权服务没响应（超时），已按离线宽限期处理。",
  network: "连不上授权服务：网络不通，或服务端没把本站来源加进跨域白名单（CORS）—— 后者在自建 LicenseHub 上最常见（部署侧要配 CORS_ORIGINS）。已按离线宽限期处理。",
};

/**
 * 传输层故障（连不上/超时）：服务端那句原话跟中文提示说的是同一件事，
 * 再贴一遍只会变成「连不上…（服务端：连不上…）」，所以这几类不追加原文。
 */
const TRANSPORT_REASONS = new Set(["network", "timeout"]);

/** 把服务端的 code + message 拼成一句给人看的话 */
export function licenseHint(reason?: string | null, message?: string | null): string {
  const hint = reason ? HINTS[reason] : undefined;
  const detail = message?.trim();
  if (!hint) return detail ?? "未知错误";
  if (!detail || TRANSPORT_REASONS.has(reason ?? "") || detail.includes(hint)) return hint;
  return `${hint}（服务端：${detail}）`;
}

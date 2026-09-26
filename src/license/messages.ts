/**
 * 错误码 → 一句人话。
 *
 * 原则：**不把 API_KEY_INVALID 这种字符串、也不把部署侧名词（后台、接口密钥、CORS）
 * 丢到界面上**。用户看到的应该是「他该做什么」；运维细节留在文档与 skill 里。
 */
const HINTS: Record<string, string> = {
  VALIDATION_FAILED: "授权码格式不对，检查一下有没有输错。",
  API_KEY_INVALID: "授权服务配置有误，请联系作者。",
  UNAUTHENTICATED: "登录已过期，请重新输入授权码。",
  SCOPE_MISSING: "授权服务权限不足，请联系作者。",
  DEVICE_BLACKLISTED: "这台设备已被停用，请联系客服。",
  LICENSE_NOT_FOUND: "授权码不存在，检查一下有没有输错（或这张码已经作废）。",
  DEVICE_LIMIT_REACHED: "设备数已满：先解绑一台旧设备，再激活这台。",
  TRIAL_ALREADY_USED: "这台设备已经领过试用了。",
  LICENSE_EXPIRED: "授权已到期，续期后即可继续创作。",
  LICENSE_REVOKED: "授权已被吊销，请联系客服。",
  LICENSE_SUSPENDED: "授权已被暂停，请联系客服。",
  RATE_LIMITED: "操作太频繁，稍等一会儿再试。",
  SIGNATURE_INVALID: "授权校验没通过（文件被改过），请重新激活。",
  NO_PUBLIC_KEY: "先联网激活一次，之后断网也能用。",
  timeout: "授权服务暂时没响应，已按离线宽限期继续放行。",
  network: "暂时连不上授权服务（网络或配置问题），已按离线宽限期继续放行。",
};

/**
 * 传输层故障（连不上/超时）：服务端那句原话跟中文提示说的是同一件事，
 * 再贴一遍只会变成「连不上…（连不上…）」，所以这几类不追加原文。
 */
const TRANSPORT_REASONS = new Set(["network", "timeout"]);

/** 把服务端的 code + message 拼成一句给人看的话 */
export function licenseHint(reason?: string | null, message?: string | null): string {
  const hint = reason ? HINTS[reason] : undefined;
  const detail = message?.trim();
  if (!hint) return detail ?? "未知错误";
  if (!detail || TRANSPORT_REASONS.has(reason ?? "") || detail.includes(hint)) return hint;
  return `${hint}（${detail}）`;
}

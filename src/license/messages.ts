/**
 * 错误码 → 一句人话。
 *
 * 原则：**不把 API_KEY_INVALID 这种字符串、也不把部署侧名词（后台、接口密钥、CORS）
 * 丢到界面上**。用户看到的应该是「他该做什么」；运维细节留在文档与 skill 里。
 *
 * 传输层（连不上/超时）按场景说话：只有「已经激活过、本地有授权文件」的心跳才谈
 * 「离线宽限期」；激活失败时没有可放行的授权，绝不能写「已按离线宽限期继续放行」。
 */

export type LicenseHintScene = "activate" | "heartbeat" | "deactivate";

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
};

/** 传输层故障：按场景给「下一步做什么」，不提跨域/部署术语 */
const TRANSPORT_HINTS: Record<"network" | "timeout", Record<LicenseHintScene, string>> = {
  network: {
    activate:
      "暂时连不上授权服务（网络或配置问题）。请检查网络后重试；若一直失败，请联系作者检查授权服务是否允许本应用访问。",
    heartbeat: "暂时连不上授权服务（网络或配置问题）。",
    deactivate: "暂时连不上授权服务（网络或配置问题）。",
  },
  timeout: {
    activate: "授权服务暂时没响应。请稍后重试；若一直失败，请联系作者确认授权服务。",
    heartbeat: "授权服务暂时没响应。",
    deactivate: "授权服务暂时没响应。",
  },
};

/** 把服务端的 code + message 拼成一句给人看的话 */
export function licenseHint(
  reason?: string | null,
  message?: string | null,
  scene: LicenseHintScene = "heartbeat",
): string {
  const detail = message?.trim();
  if (reason === "network" || reason === "timeout") {
    return TRANSPORT_HINTS[reason][scene];
  }
  const hint = reason ? HINTS[reason] : undefined;
  if (!hint) return detail ?? "未知错误";
  // 服务端原文与中文提示说的若是同一件事（互相包含），就不再重复一遍
  if (!detail || detail.includes(hint) || hint.includes(detail)) return hint;
  return `${hint}（${detail}）`;
}

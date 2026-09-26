---
feature: license-activation-failure
status: designed
updated: 2026-09-27
branch: fix/license-activation-cors
commits: # leave empty while in progress; fill at delivery
---

# 授权激活失败修复（跨域放行 + 分场景文案）

## Report

## [S1] Problem

用户在「设置 → 授权激活」填入授权码后，界面显示：

> 激活失败，暂时连不上授权服务（网络或配置问题），已按离线宽限期继续放行。

两个独立问题叠在一起：

1. **服务端 CORS 未放行浏览器来源**。`https://shouquan.reshui.xin` 对任意 Origin 的预检/实际请求都**不返回 `Access-Control-Allow-Origin`**（Nest `enableCors` 只允许 `APP_ORIGIN`，生产 `CORS_ORIGINS` 为空）。浏览器里 `fetch` 变成 `TypeError: Failed to fetch`，SDK 归类成 `reason: 'network'`。curl/Node 无 CORS，所以看起来“服务是好的”。
2. **激活失败文案在说谎**。`HINTS.network` / `HINTS.timeout` 固定带「已按离线宽限期继续放行」——只有**已激活且本地已有授权文件**的心跳失败才谈得上宽限期；激活失败时没有可放行的授权，用户被误导以为还能继续创作。

## [S2] Design

### 服务端（LicenseHub）：多 Origin CORS

- `loadConfig` 解析 `corsOrigins = unique([APP_ORIGIN, ...CORS_ORIGINS.split(',')])`（trim、去空）。
- `configureApp` 使用 `enableCors({ origin: config.corsOrigins, credentials: true, exposedHeaders: ['X-Request-Id'] })`。
- `apps/api/.env.example` 与 `docs/DEPLOYMENT.md` 写明：上游网页应用（如 novelcraft `http://127.0.0.1:5178` / 对外域名）必须写入 `CORS_ORIGINS`，改完重启 API。
- 生产部署需在服务器 `.env` 补上 novelcraft 实际访问来源后重启；本仓库交付的是代码 + 文档 + 单测。

### 客户端（novelcraft）：分场景错误文案

- `licenseHint(reason, message, scene?)`，`scene ∈ 'activate' | 'heartbeat' | 'deactivate'`（默认 `heartbeat`）。
- **去掉**基线里的「已按离线宽限期继续放行」。
- `network` / `timeout` 按场景给可执行下一步，且**不出现** CORS / 接口密钥 / 部署术语：
  - `activate`：检查网络后重试；一直失败则联系作者确认授权服务（暗示放行本页面地址）。
  - `heartbeat`：说明暂时连不上；调用方继续拼「（暂时可以继续使用）」。
  - `deactivate`：说明请求未发出、本机仍激活、稍后重试。
- 激活成功/业务错误（授权码错、设备满等）文案不变。
- 状态卡本地判定逻辑不变；`verify-license.mjs` 与纯函数回归覆盖新文案。

### 错误行为边界

| 场景 | 期望用户可见结果 |
| --- | --- |
| 激活 · network/timeout | 无“宽限期放行”字样；有重试/联系作者 |
| 激活 · 业务错误（LICENSE_NOT_FOUND 等） | 现有 hint + 可选服务端 detail |
| 心跳 · network/timeout | 提示连不上 + 「暂时可以继续使用」 |
| 解绑 · network/timeout | 明确“没发出去、仍是激活状态” |
| 心跳/本地 · 已过期但在宽限期 | 既有 `grace` 文案，不动 |

## [S3] Out of Scope

- 不改 LicenseHub 鉴权、激活 API、签名格式。
- 不把授权请求挪到 novelcraft 服务端代理 / 本地 proxy（用户明确不走这条）。
- 不在授权页暴露连接配置输入框。
- 不自动改生产服务器 `.env`（交付文档与代码；部署动作由作者执行）。
- 不处理域名授权线（已删除）。

## Tasks

- [ ] T1: LicenseHub 多 Origin CORS（config + enableCors + .env.example）— acceptance: `CORS_ORIGINS=a,b` 时 `corsOrigins` 含 APP_ORIGIN 与 a、b；单测通过 (covers: S2)
- [ ] T2: LicenseHub 部署文档写清 `CORS_ORIGINS` — acceptance: DEPLOYMENT.md 含该变量与 novelcraft 来源示例 (covers: S2)
- [ ] T3: novelcraft 分场景 `licenseHint` — acceptance: activate 的 network 文案不含「宽限期」；heartbeat 仍可拼宽限后缀；类型检查通过 (covers: S2)
- [ ] T4: novelcraft 接线 activate/heartbeat/deactivate 调用 scene — acceptance: 激活失败不再显示「已按离线宽限期继续放行」 (covers: S2; depends: T3)
- [ ] T5: 回归与验证 — acceptance: LicenseHub configuration 测试 + novelcraft 文案断言 + 浏览器实测 CORS 头（本地 hub） (covers: S1, S2; depends: T1, T4)

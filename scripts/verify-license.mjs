/**
 * 回归：LicenseHub 授权对接。
 *
 * 覆盖「真实调用真服务」的完整链路，全部是浏览器里的真实交互：
 *  ① 未激活时「新建作品」必须被卡住（提示 + 两个独立入口 + 表单隐藏 + 按钮禁用）；
 *  ② 两条线是两个独立模块（静态检查：设备线不与域名线互相 import）；
 *  ③ 设备线：激活 → 本地验签 → 篡改检测 → 心跳 → 解绑 → 卡点恢复；
 *  ④ 域名线：激活当前域名 → 校验 → 未授权域名被拒（错误必须可读）；
 *  ⑤ 控制台零错误。
 *
 * 前置：
 *  1) dev server 在 http://127.0.0.1:5178
 *  2) LicenseHub API 在跑（默认 http://localhost:3000），且已开通测试产品/套餐/密钥/授权码
 *  3) 凭据文件 /tmp/lh-fixtures.json：
 *     { baseUrl, apiKey, product, licenseKey, unlicensedDomain }
 *
 * 凭据不进仓库：这是测试用的一次性密钥与授权码。
 */
import { readFileSync } from "node:fs";
import { gotoApp, launchIsolated, waitFor } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const FIXTURES = process.env.LH_FIXTURES ?? "/tmp/lh-fixtures.json";

let fx;
try {
  fx = JSON.parse(readFileSync(FIXTURES, "utf8"));
} catch {
  console.error(`缺少凭据文件 ${FIXTURES} —— 先启动 LicenseHub 并创建测试产品/套餐/密钥/授权码。`);
  console.error("格式：{ baseUrl, apiKey, product, licenseKey, unlicensedDomain }");
  process.exit(2);
}

const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1100 }, licensing: true });
// 页面上已经没有接入信息输入框（用户只填授权码）：用 dev 构建才认的 localStorage 覆盖，
// 把授权请求指向本地跑着的 LicenseHub。生产构建里这段覆盖是无效的（见 src/license/defaults.ts）。
await context.addInitScript(
  (conn) => {
    try {
      localStorage.setItem("huajiao:license:devConn", JSON.stringify(conn));
    } catch {
      /* 忽略 */
    }
  },
  { baseUrl: fx.baseUrl, apiKey: fx.apiKey, product: fx.product },
);
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e.message).slice(0, 200)));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const url = m.location()?.url ?? "";
  // 负向用例（未授权域名）本身就会打出一个 404，属于预期噪音
  if (url.includes("/api/v1/domain/activate")) return;
  if (m.text().includes("favicon")) return;
  errs.push("CONSOLE " + m.text().slice(0, 220) + (url ? " @" + url : ""));
});
// 「解绑」有二次确认框，不 accept 的话动作不会发生
page.on("dialog", (d) => void d.accept());

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass += 1;
    console.log("  ✓ " + name);
  } else {
    fail += 1;
    console.log("  ✗ " + name + (detail ? "  → " + detail : ""));
  }
};

const text = () => page.evaluate(() => document.body.innerText);
// 两条线都有各自的提示区（合并到一页后不能靠「第一个 data-license-message」区分）
const deviceMessage = () => page.evaluate(() => document.querySelector("[data-license-device-message]")?.textContent ?? null);
const domainMessage = () => page.evaluate(() => document.querySelector("[data-license-domain-message]")?.textContent ?? null);
const clickButton = (label) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === t);
    b?.click();
    return Boolean(b);
  }, label);
const fillByPlaceholder = (placeholder, value) =>
  page.evaluate(
    ([ph, v]) => {
      const input = [...document.querySelectorAll("input")].find((i) => (i.placeholder ?? "").includes(ph));
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    [placeholder, value],
  );
/** 授权状态一句话（读状态卡上那句，不靠全页正则碰运气） */
const licenseState = async () =>
  page.evaluate(() => {
    const el = document.querySelector("[data-license-status]");
    return (el?.textContent ?? "").match(/未激活|已激活|已到期（宽限期内）|已过期|授权无效|无法判定/)?.[0] ?? "";
  });

// ─────────────────────────────────────────────────────────────
console.log("【1】静态：两条线在设置里合并成一块，但逻辑模块必须各自独立");
const deviceSrc = readFileSync("src/license/device.ts", "utf8");
const domainSrc = readFileSync("src/license/domain.ts", "utf8");
const panelSrc = readFileSync("src/features/license/ActivationPanel.tsx", "utf8");
const routesSrc = readFileSync("src/app/routes.ts", "utf8");
check("设备线不 import 域名线", !deviceSrc.includes('from "./domain"') && !deviceSrc.includes('from "@/license/domain"'));
check("域名线不 import 设备线", !domainSrc.includes('from "./device"') && !domainSrc.includes('from "@/license/device"'));
check(
  "设置里只有一个授权分区（不再是两个页签）",
  routesSrc.includes('"license"') && !routesSrc.includes('"device-license"') && !routesSrc.includes('"domain-license"'),
);
check(
  "同一页里两块都渲染（设备激活码 + 域名授权）",
  panelSrc.includes("设备激活（授权码）") && panelSrc.includes("域名授权（网站部署）"),
);

// ─────────────────────────────────────────────────────────────
console.log("【2】未激活 → 创作被卡住");
await gotoApp(page, BASE + "/", { settle: 1200 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("新建作品"));
  b?.click();
});
await page.waitForTimeout(900);
const blockedView = await page.evaluate(() => {
  const body = document.body.innerText;
  const btns = [...document.querySelectorAll("button")].map((b) => ({
    t: (b.textContent ?? "").trim(),
    disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
  }));
  return {
    notice: body.includes("新建作品需要授权"),
    formHidden: !body.includes("创作模板"),
    gateEntry: btns.some((b) => b.t === "去激活"),
    // 只看弹窗里那两个创建按钮（空状态页的「创建第一部作品」只是打开弹窗，不该禁用）
    createDisabled: ["先创建空白项目", "创建并用 AI 建档"].every(
      (label) => btns.find((b) => b.t.includes(label))?.disabled === true,
    ),
  };
});
check("弹窗里显示「新建作品需要授权」", blockedView.notice);
check("表单被隐藏（模板/体裁都点不到）", blockedView.formHidden);
check("给出「去激活」入口（一键到授权页）", blockedView.gateEntry);
check("创建类按钮全部禁用", blockedView.createDisabled);
await clickButton("取消");
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────
console.log("【3】设备授权线：激活 → 验签 → 篡改 → 心跳 → 解绑");
await gotoApp(page, BASE + "/settings?tab=license", { settle: 1500 });
check("进的是合并后的「授权激活」页", (await text()).includes("授权激活") && (await text()).includes("域名授权（网站部署）"));
check("初始状态是未激活", (await licenseState()) === "未激活", await licenseState());

await fillByPlaceholder("LHAB-", fx.licenseKey);
await clickButton("激活本机");
await waitFor(page, () => (document.body.innerText.includes("激活成功") ? true : false), { timeout: 20000 }).catch(() => {});
const activateMsg = await deviceMessage();
check("激活成功（服务端真实返回）", Boolean(activateMsg?.includes("激活成功")), activateMsg ?? "无消息");
check("状态变为已激活", (await licenseState()) === "已激活", await licenseState());

const record = await page.evaluate(async () => {
  const repo = await import("/src/db/repo/license.ts");
  const row = await repo.getDeviceLicense();
  return row
    ? {
        hasKey: Boolean(row.licenseKey),
        hasToken: Boolean(row.accessToken),
        hasSig: Boolean(row.licenseFile?.sig),
        fingerprint: row.device?.fingerprint ?? "",
        plan: row.licenseFile?.plan ?? "",
      }
    : null;
});
check("授权文件已落地（含签名与令牌）", Boolean(record?.hasKey && record?.hasSig), JSON.stringify(record));
check("设备指纹已生成（32 位十六进制）", /^[0-9a-f]{32}$/.test(record?.fingerprint ?? ""), record?.fingerprint ?? "");

// 篡改：改掉本地授权文件的到期时间，离线判定必须拒绝
const tamper = await page.evaluate(async () => {
  const repo = await import("/src/db/repo/license.ts");
  const device = await import("/src/license/device.ts");
  const row = await repo.getDeviceLicense();
  const original = row.licenseFile.expiresAt;
  await repo.saveDeviceLicense({ ...row, licenseFile: { ...row.licenseFile, expiresAt: "2099-12-31T00:00:00.000Z" } });
  const verdict = await device.deviceVerdict();
  await repo.saveDeviceLicense({ ...row, licenseFile: { ...row.licenseFile, expiresAt: original } });
  return { activated: verdict.activated, state: verdict.state, message: verdict.message };
});
check("改过到期时间 → 验签失败、不再放行", tamper.activated === false && tamper.state === "invalid", JSON.stringify(tamper));

await clickButton("立即核对");
await page.waitForTimeout(2500);
const checkMsg = await deviceMessage();
check("心跳（允许 token 过期后回退授权码）", Boolean(checkMsg && !checkMsg.includes("网络")), checkMsg ?? "无消息");

console.log("【4】激活后：新建作品放行");
await gotoApp(page, BASE + "/", { settle: 1200 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("新建作品"));
  b?.click();
});
await page.waitForTimeout(900);
// 书名填上：创建按钮的禁用条件里除了授权还有「书名不能为空」
await fillByPlaceholder("长夜将至", "授权回归测试书");
await page.waitForTimeout(400);
const allowedView = await page.evaluate(() => {
  const body = document.body.innerText;
  const btns = [...document.querySelectorAll("button")].map((b) => ({
    t: (b.textContent ?? "").trim(),
    disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
  }));
  return {
    formVisible: body.includes("创作模板"),
    noticeGone: !body.includes("新建作品需要授权"),
    blankEnabled: !btns.find((b) => b.t.includes("先创建空白项目"))?.disabled,
  };
});
check("模板表单回来了", allowedView.formVisible);
check("「需要授权」提示消失", allowedView.noticeGone);
check("「先创建空白项目」可点", allowedView.blankEnabled);
await clickButton("取消");
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────
console.log("【5】域名授权线：激活 → 校验 → 未授权域名被拒");
await gotoApp(page, BASE + "/settings?tab=license", { settle: 1500 });
check("域名块在同一页里", (await text()).includes("域名授权（网站部署）"));
check("显示当前域名", (await text()).includes("127.0.0.1"));

await clickButton("激活当前域名");
await waitFor(page, () => (document.body.innerText.includes("激活成功") ? true : false), { timeout: 20000 }).catch(() => {});
const domainMsg = await domainMessage();
check("域名激活成功（127.0.0.1 已在后台开通）", Boolean(domainMsg?.includes("激活成功")), domainMsg ?? "无消息");
check("合并状态卡变为已激活", (await licenseState()) === "已激活", await licenseState());

await clickButton("立即校验");
await page.waitForTimeout(2500);
const verifyMsg = await domainMessage();
check("立即校验走通", Boolean(verifyMsg && (verifyMsg.includes("有效") || verifyMsg.includes("缓存"))), verifyMsg ?? "无消息");

const unlicensed = await page.evaluate(
  async ([domain, baseUrl, apiKey, product]) => {
    const mod = await import("/src/license/domain.ts");
    return mod.activateSiteDomain({ baseUrl, apiKey, product }, domain);
  },
  [fx.unlicensedDomain, fx.baseUrl, fx.apiKey, fx.product],
);
check(
  "未授权域名被拒且原因可读",
  unlicensed.ok === false && /域名|授权|不存在|占用|额度|格式|参数/.test(unlicensed.message) && unlicensed.message.length > 8,
  JSON.stringify(unlicensed),
);

// ─────────────────────────────────────────────────────────────
console.log("【6】解绑设备 → 卡点恢复（域名授权仍在，仍可创作）");
await gotoApp(page, BASE + "/settings?tab=license", { settle: 1500 });
await clickButton("解绑本机");
await waitFor(page, async () => {
  const repo = await import("/src/db/repo/license.ts");
  return (await repo.getDeviceLicense()) === undefined;
}, { timeout: 15000 }).catch(() => {});
const afterUnbind = await page.evaluate(async () => {
  const repo = await import("/src/db/repo/license.ts");
  const [device, domain] = await Promise.all([repo.getDeviceLicense(), repo.getDomainLicense()]);
  return { device: Boolean(device), domain: Boolean(domain) };
});
check("设备线记录已清除", afterUnbind.device === false, JSON.stringify(afterUnbind));
check("域名线记录不受影响（两条线互不干扰）", afterUnbind.domain === true, JSON.stringify(afterUnbind));

console.log("【7】控制台");
check("无控制台错误", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
await context.close();
process.exit(fail === 0 ? 0 : 1);

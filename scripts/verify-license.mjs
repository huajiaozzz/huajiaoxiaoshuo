/**
 * 回归：LicenseHub 设备授权（授权码线）。
 *
 * 全部是浏览器里的真实交互 + 真服务：
 *  ① 静态：只有设备线；设置里只有一个「授权激活」分区；页面上没有接入信息输入框；
 *  ② 未激活时「新建作品」被卡住（提示可读 + 一键去激活 + 创建按钮禁用）；
 *  ③ 真实激活 → 本地 Ed25519 验签 → 篡改授权文件必须被拒 → 心跳；
 *  ④ 激活后放行（模板表单回来、按钮可点）；
 *  ⑤ 解绑后卡点恢复；
 *  ⑥ 控制台零错误。
 *
 * 前置：dev server 在 5178、LicenseHub 在跑、/tmp/lh-fixtures.json：
 *   { baseUrl, apiKey, product, licenseKey }
 * 跑法：node scripts/verify-license.mjs
 */
import { readFileSync } from "node:fs";
import { gotoApp, launchIsolated, waitFor } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";

let fx;
try {
  fx = JSON.parse(readFileSync("/tmp/lh-fixtures.json", "utf8"));
} catch {
  console.error("缺少 /tmp/lh-fixtures.json（{ baseUrl, apiKey, product, licenseKey }）—— 先按 skill license-hub-ops 起 LicenseHub 并造测试数据");
  process.exit(2);
}

// licensing: true = 关掉 dev 绕行，真刀真枪测卡点
const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1100 }, licensing: true });
// 页面上没有接入信息输入框（用户只填授权码）：用 dev 构建才认的 localStorage 覆盖把请求指向本地 LicenseHub
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
    console.log("  \u2713 " + name);
  } else {
    fail += 1;
    console.log("  \u2717 " + name + (detail ? "  \u2192 " + detail : ""));
  }
};

const text = () => page.evaluate(() => document.body.innerText);
const licenseMessage = () => page.evaluate(() => document.querySelector("[data-license-message]")?.textContent ?? null);
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
/** 授权状态一句话（读状态卡上的标记，不靠全页正则碰运气） */
const licenseState = async () =>
  page.evaluate(() => {
    const el = document.querySelector("[data-license-status]");
    return (el?.textContent ?? "").match(/未激活|已激活|已到期（暂时可继续使用）|已过期|授权无效|暂时无法确认/)?.[0] ?? "";
  });

// ─────────────────────────────────────────────────────────────
console.log("【1】静态：只有设备线，且没有接入信息输入框");
const deviceSrc = readFileSync("src/license/device.ts", "utf8");
const panelSrc = readFileSync("src/features/license/ActivationPanel.tsx", "utf8");
const routesSrc = readFileSync("src/app/routes.ts", "utf8");
check("设备线不引用域名线", !deviceSrc.includes("domain") && !deviceSrc.includes("Domain"));
check("设置里只有一个授权分区", routesSrc.includes('"license"') && !routesSrc.includes("device-license"));
check("授权页不再有「域名授权」块", !panelSrc.includes("域名授权"));
check(
  "页面上没有接入信息输入框（用户只填授权码）",
  !panelSrc.includes("apiKey") && !panelSrc.includes("授权服务地址") && !panelSrc.includes("接口密钥"),
);
check("域名线的模块已经删掉（不留死代码）", !readFileSync("src/license/types.ts", "utf8").includes("DomainLicense"));

// ─────────────────────────────────────────────────────────────
console.log("【2】未激活 → 只卡 AI 功能（空白项目照建）");
await gotoApp(page, BASE + "/", { settle: 1200 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("新建作品"));
  b?.click();
});
await page.waitForTimeout(900);
// 先填书名：创建按钮的禁用条件里还有「书名不能为空」
await fillByPlaceholder("长夜将至", "授权回归测试书");
await page.waitForTimeout(500);
const openView = await page.evaluate(() => {
  const body = document.body.innerText;
  const btns = [...document.querySelectorAll("button")].map((b) => ({
    t: (b.textContent ?? "").trim(),
    disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
  }));
  return {
    noBlockNotice: !body.includes("新建作品需要授权"),
    formVisible: body.includes("创作模板") && body.includes("书名"),
    blankEnabled: !btns.find((b) => b.t.includes("先创建空白项目"))?.disabled,
  };
});
check("弹窗不再整体拦（没有「新建作品需要授权」）", openView.noBlockNotice);
check("表单照常可填（模板/书名都在）", openView.formVisible);
check("「先创建空白项目」可点（不卡创作）", openView.blankEnabled);

// 点 AI 建档 → 该亮提示
await clickButton("创建并用 AI 建档");
await page.waitForTimeout(900);
const aiBlocked = await page.evaluate(() => {
  const body = document.body.innerText;
  const btns = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
  return {
    notice: body.includes("AI 功能需要授权"),
    gateEntry: btns.includes("去激活"),
    formStillThere: body.includes("创作模板"),
  };
});
check("点「创建并用 AI 建档」才提示「AI 功能需要授权」", aiBlocked.notice);
check("提示里有「去激活」入口", aiBlocked.gateEntry);
check("提示不挡表单（表单还在）", aiBlocked.formStillThere);

// 切到「AI 选题」页签点「生成选题」→ 同样提示
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button,[role=tab]")].find((x) => (x.textContent ?? "").trim() === "AI 选题");
  tab?.click();
});
await page.waitForTimeout(600);
await clickButton("生成选题");
await page.waitForTimeout(900);
check("点「生成选题」也提示（AI 选题同样要授权）", (await text()).includes("AI 功能需要授权"));
await clickButton("取消");
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────
console.log("【3】设备线：激活 → 验签 → 篡改 → 心跳");
await gotoApp(page, BASE + "/settings?tab=license", { settle: 1500 });
check("进的是「授权激活」页", (await text()).includes("授权激活") && (await text()).includes("设备激活"));
check("初始状态是未激活", (await licenseState()) === "未激活", await licenseState());

await fillByPlaceholder("LHAB-", fx.licenseKey);
await clickButton("激活本机");
await waitFor(page, () => (document.body.innerText.includes("激活成功") ? true : false), { timeout: 20000 }).catch(() => {});
const activateMsg = await licenseMessage();
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
  if (!row?.licenseFile) return { activated: null, state: "no-record", message: "没有授权记录可篡改（激活没成功）" };
  const original = row.licenseFile.expiresAt;
  await repo.saveDeviceLicense({ ...row, licenseFile: { ...row.licenseFile, expiresAt: "2099-12-31T00:00:00.000Z" } });
  const verdict = await device.deviceVerdict();
  await repo.saveDeviceLicense({ ...row, licenseFile: { ...row.licenseFile, expiresAt: original } });
  return { activated: verdict.activated, state: verdict.state, message: verdict.message };
});
check("改过到期时间 → 验签失败、不再放行", tamper.activated === false && tamper.state === "invalid", JSON.stringify(tamper));

// 心跳不再靠按钮触发（界面上已删「立即核对」），直接调设备层强制核对
const checkMsg = await page.evaluate(async () => {
  const device = await import("/src/license/device.ts");
  const res = await device.heartbeatDevice(true);
  return res?.message ?? null;
});
check("心跳（允许 token 过期后回退授权码）", Boolean(checkMsg && !checkMsg.includes("网络")), checkMsg ?? "无消息");

// ─────────────────────────────────────────────────────────────
console.log("【4】激活后：AI 动作放行");
await gotoApp(page, BASE + "/", { settle: 1200 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("新建作品"));
  b?.click();
});
await page.waitForTimeout(900);
await fillByPlaceholder("长夜将至", "授权回归测试书");
await page.waitForTimeout(500);
await clickButton("创建并用 AI 建档");
await page.waitForTimeout(1200);
const afterActivate = await page.evaluate(() => {
  const body = document.body.innerText;
  return {
    noticeGone: !body.includes("AI 功能需要授权"),
    movedOn: location.pathname.includes("/genesis") || body.includes("一句话成书"),
  };
});
check("「AI 功能需要授权」提示消失", afterActivate.noticeGone);
check("AI 建档流程真的往下走了", afterActivate.movedOn);

// ─────────────────────────────────────────────────────────────
console.log("【5】解绑 → 卡点恢复");
await gotoApp(page, BASE + "/settings?tab=license", { settle: 1500 });
await clickButton("解绑本机");
await waitFor(page, async () => {
  const repo = await import("/src/db/repo/license.ts");
  return (await repo.getDeviceLicense()) === undefined;
}, { timeout: 15000 }).catch(() => {});
const unbound = await page.evaluate(async () => {
  const repo = await import("/src/db/repo/license.ts");
  return (await repo.getDeviceLicense()) === undefined;
});
check("设备线记录已清除", unbound === true);
await gotoApp(page, BASE + "/", { settle: 1200 });
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").includes("新建作品"));
  b?.click();
});
await page.waitForTimeout(900);
// 要先填书名：创建按钮的禁用条件里还有「书名不能为空」，否则点不到、也就看不到提示
await fillByPlaceholder("长夜将至", "授权回归测试书");
await page.waitForTimeout(500);
await clickButton("创建并用 AI 建档");
await page.waitForTimeout(900);
check("卡点恢复（点 AI 又提示要授权）", (await text()).includes("AI 功能需要授权"));
await clickButton("取消");

// ─────────────────────────────────────────────────────────────
console.log("【6】控制台");
check("无控制台错误", errs.length === 0, errs.slice(0, 4).join(" | "));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
await context.close();
process.exit(fail === 0 ? 0 : 1);

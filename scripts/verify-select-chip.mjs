/**
 * 回归：所有「可选芯片」（SelectChip）的选中态都必须看得出来。
 *
 * 背景（真实事故）：HeroUI v3 的 Chip 把颜色与变体拆成两个维度 —— `.chip` 的底色恒为
 * --default，`.chip--accent` 只改文字色；而本主题把品牌色做成中性灰
 * （--accent-soft-foreground 与 --default-foreground 同值），
 * 于是 `color={选中 ? "accent" : "default"}` 这种写法渲染出来**一模一样**：
 * 全站 16 处选择控件点了没反应。作者的报障原话就是「怎么选不了」。
 *
 * 这条回归守三件事：
 *  ① 源码里不许再出现「靠 Chip 颜色表达选中」的写法（它会让人误以为生效）；
 *  ② 选中的芯片必须带 .chip--selected 与勾（SelectChip 的行为约定）；
 *  ③ 选中 / 未选中的**渲染结果**必须有可见差异（底色、内描边、字重）。
 *
 * 前置：dev server 在 5178。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { gotoApp, launchIsolated, waitFor } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";

const context = await launchIsolated(import.meta.url, { viewport: { width: 1512, height: 1100 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e.message).slice(0, 180)));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errs.push("CONSOLE " + m.text().slice(0, 200));
});

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

// ─────────────────────────────────────────────────────────────
// ① 静态：源码里不许再有「靠 Chip 颜色表达选中」
// ─────────────────────────────────────────────────────────────
console.log("【1】源码不再靠 Chip 颜色表达选中");
const ANTI = /color=\{[^}]*"accent"[^}]*"default"/;
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
};
const offenders = [];
for (const file of walk("src")) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const t = line.trim();
      const comment = t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
      if (!comment && ANTI.test(line)) offenders.push(`${file}:${i + 1}`);
    });
}
check("没有残留 color={… ? \"accent\" : \"default\"}", offenders.length === 0, offenders.join(", "));

// ─────────────────────────────────────────────────────────────
// ② 通用探针：找页面上成员最多的一组 aria-pressed 芯片，读它们的真实渲染样式
// ─────────────────────────────────────────────────────────────
const probeRow = () =>
  page.evaluate(() => {
    const groups = new Map();
    for (const b of document.querySelectorAll("button[aria-pressed]")) {
      const p = b.parentElement;
      if (!p) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(b);
    }
    let best = null;
    for (const arr of groups.values()) if (!best || arr.length > best.length) best = arr;
    if (!best || best.length < 2) return null;
    const read = (b) => {
      const chip = b.querySelector(".chip") ?? b;
      const cs = getComputedStyle(chip);
      return {
        text: (b.textContent ?? "").trim(),
        pressed: b.getAttribute("aria-pressed"),
        marked: Boolean(b.querySelector(".chip--selected")),
        tick: Boolean(b.querySelector("svg")),
        bg: cs.backgroundColor,
        ring: cs.boxShadow,
        weight: cs.fontWeight,
      };
    };
    return { count: best.length, items: best.map(read) };
  });

const clickChip = (text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button[aria-pressed]")].find(
      (x) => (x.textContent ?? "").trim() === t,
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);

/** 选中项 vs 未选中项：有没有可见差异 */
const visible = (sel, other) =>
  sel.bg !== other.bg || sel.ring !== other.ring || sel.weight !== other.weight;

/** 一个选择控件区的完整断言 */
async function checkRow(label, pickFirst) {
  const before = await probeRow();
  if (!before) {
    check(`${label}：找到可点芯片`, false, "没找到 aria-pressed 芯片组");
    return;
  }
  const target = before.items[pickFirst];
  const others = before.items.filter((_, i) => i !== pickFirst);
  const clicked = await clickChip(target.text);
  await page.waitForTimeout(250);
  const after = await probeRow();
  const now = after.items[pickFirst];
  const other = others.length ? after.items.find((it) => it.text === others[0].text) : null;

  check(`${label}：点得动（"${target.text}"）`, clicked);
  check(`${label}：点后 aria-pressed 变 true`, now.pressed === "true", `pressed=${now.pressed}`);
  check(`${label}：选中项带 .chip--selected`, now.marked === true);
  check(`${label}：选中项带勾`, now.tick === true);
  check(
    `${label}：选中态看得见（底色/内描边/字重）`,
    other ? visible(now, other) : visible(now, before.items[pickFirst]),
    other ? `sel=${now.bg} / ${now.ring} / ${now.weight}  vs  other=${other.bg} / ${other.ring} / ${other.weight}` : "",
  );
}

// ─────────────────────────────────────────────────────────────
// ③ 设置 · 创作者档案：惯用体裁（多选）
// ─────────────────────────────────────────────────────────────
console.log("【2】设置 · 创作者档案 的「惯用体裁」");
await gotoApp(page, BASE + "/settings?tab=profile", { settle: 1500 });
await waitFor(page, () => document.querySelectorAll("button[aria-pressed]").length >= 2, { timeout: 10000 }).catch(
  () => {},
);
await checkRow("创作者档案", 1);

// ─────────────────────────────────────────────────────────────
// ④ 新建作品：内置模板库的分类筛选
// ─────────────────────────────────────────────────────────────
console.log("【3】新建作品 · 内置模板库 的分类筛选");
await gotoApp(page, BASE + "/new", { settle: 1500 });
if (await waitFor(page, () => document.querySelectorAll("button[aria-pressed]").length >= 2, { timeout: 10000 }).catch(() => false)) {
  await checkRow("模板库分类", 1);
} else {
  check("模板库分类：找到可点芯片", false, "新建作品弹窗里没有分类芯片");
}

// ─────────────────────────────────────────────────────────────
// ⑤ 控制台必须干净
// ─────────────────────────────────────────────────────────────
console.log("【4】控制台");
check("无控制台错误", errs.length === 0, errs.slice(0, 3).join(" | "));

console.log(`\n通过 ${pass} / ${pass + fail}`);
await context.close();
process.exit(fail === 0 ? 0 : 1);

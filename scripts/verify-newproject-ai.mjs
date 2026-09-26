/**
 * 回归：新建作品 → 模板区「AI 选题」。
 *
 * 这个功能真正会出事的地方，不是"能不能生成"，而是：
 *  ① 生成失败时界面必须留下**可见的错误** —— 作者最恨「点了没反应」；
 *  ② 选中的选题必须真的带出书名 / 一句话故事 / 简介 / 体裁 / 篇幅 / 视角；
 *  ③ 「创建并用 AI 建档」要把选题的 seed 带进「一句话成书」，
 *     否则作者刚在弹窗里写的那句灵感，到了下一页还得重打一遍。
 *
 * 前置：dev server 在 5178；node scripts/mock-llm.mjs 8765 已启动。
 */
import { gotoApp, launchIsolated, waitFor } from "./lib/browser.mjs";
import { MOCK_TOPICS } from "./fixtures/mock-topics.mjs";

const BASE = "http://127.0.0.1:5178";
const MOCK = "http://127.0.0.1:8765/v1";
const DEAD = "http://127.0.0.1:9/v1"; // 连不上的端口，用来验证失败路径

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

/** 装一个供应商并把全局默认模型指过去（做法与 scripts/ai-e2e.mjs 一致） */
async function installProvider(baseUrl) {
  return page.evaluate(
    async ([url]) => {
      const settingsRepo = await import("/src/db/repo/settings.ts");
      const prov = await settingsRepo.upsertProvider({
        id: "prov_verify",
        name: "验证用模型",
        kind: "custom",
        baseUrl: url,
        models: ["mock-story-model"],
        enabled: true,
        corsBlocked: false,
      });
      const raw = localStorage.getItem("huajiao:settings");
      const cur = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        "huajiao:settings",
        JSON.stringify({
          ...cur,
          activeProviderId: prov.id,
          activeModel: "mock-story-model",
          stream: false,
          contextBudget: 12000,
        }),
      );
      return prov.id;
    },
    [baseUrl],
  );
}

/** 打开新建作品弹窗并切到 AI 选题 */
async function openAiPanel(routeUrl) {
  await gotoApp(page, routeUrl);
  await waitFor(page, () => (document.body.innerText.includes("新建作品") ? true : false));
  await page.click("text=AI 选题");
  await page.waitForTimeout(200);
}

const formState = () =>
  page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")];
    const byPlaceholder = (needle) =>
      inputs.find((i) => (i.placeholder || "").includes(needle))?.value ?? "";
    const areas = [...document.querySelectorAll("textarea")];
    const areaByPlaceholder = (needle) =>
      areas.find((t) => (t.placeholder || "").includes(needle))?.value ?? "";
    const dead = document.querySelector("[data-ai-error]");
    return {
      title: byPlaceholder("长夜将至"),
      logline: areaByPlaceholder("下一具尸体"),
      synopsis: areaByPlaceholder("主线"),
      seed: areaByPlaceholder("名字出现在下一具尸体上"),
      error: dead ? dead.innerText.trim() : "",
      cards: document.querySelectorAll("[data-topic-card]").length,
      hasAnotherBatch: document.body.innerText.includes("换一批"),
    };
  });

// ---------- 1. 正常路径 ----------
await gotoApp(page, BASE + "/");
await installProvider(MOCK);
await openAiPanel(BASE + "/new");

console.log("【AI 选题：正常路径】");
check("弹窗里出现「AI 选题」入口", (await page.evaluate(() => document.body.innerText.includes("AI 选题"))) === true);

// 倾向分类：点了必须**看得出**（历史问题：Chip 的 accent 与 default 计算样式完全相同，
// 选中了却看不出来，作者会直接判定「选不了」）
// 注意：不能写 "button:text-is(...)" —— Playwright 的 :text-is() 只匹配**最小**元素，
// 而 SelectChip 的文字在内层 .chip 里，按钮本身不再是「最小元素」，会永远等不到。
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === "科幻未来");
  b?.click();
});
await page.waitForTimeout(250);
const catState = await page.evaluate(() => {
  const pick = (t) =>
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === t);
  const pickLike = (t) =>
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().replace(/^✓\s*/, "") === t);
  const sel = pick("科幻未来") ?? pickLike("科幻未来");
  const other = pick("不限") ?? pickLike("不限");
  // 样式落在内层 .chip 上（SelectChip 用 --chip-bg + 内描边 + 字重表示选中）
  const chipOf = (b) => b?.querySelector(".chip") ?? null;
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const selChip = chipOf(sel);
  const otherChip = chipOf(other);
  return {
    selPressed: sel?.getAttribute("aria-pressed") ?? null,
    otherPressed: other?.getAttribute("aria-pressed") ?? null,
    selHasTick: Boolean(sel?.querySelector("svg")),
    otherHasTick: Boolean(other?.querySelector("svg")),
    selMarked: Boolean(selChip?.classList.contains("chip--selected")),
    otherMarked: Boolean(otherChip?.classList.contains("chip--selected")),
    ringDiffers: Boolean(selChip && otherChip && cs(selChip).boxShadow !== cs(otherChip).boxShadow),
    fillDiffers: Boolean(selChip && otherChip && cs(selChip).backgroundColor !== cs(otherChip).backgroundColor),
    weightDiffers: Boolean(selChip && otherChip && cs(selChip).fontWeight !== cs(otherChip).fontWeight),
  };
});
check("倾向分类可选中", catState.selPressed === "true" && catState.otherPressed === "false", JSON.stringify(catState));
check(
  "选中态看得见（勾 + 底色 + 内描边 + 加粗）",
  catState.selHasTick &&
    !catState.otherHasTick &&
    catState.selMarked &&
    !catState.otherMarked &&
    catState.ringDiffers &&
    catState.fillDiffers &&
    catState.weightDiffers,
  JSON.stringify(catState),
);

await page.fill('textarea[placeholder*="雾港"]', "雾港、能听见死者遗言的验尸官、记忆可以出租");
await page.click("text=生成选题");

const cardCount = await waitFor(
  page,
  () => document.querySelectorAll("[data-topic-card]").length || 0,
  { timeout: 30000 },
);
check("生成出选题卡片", cardCount >= 3, "cards=" + cardCount);
check("卡片数与模型返回一致", cardCount === MOCK_TOPICS.length, `cards=${cardCount} 期望=${MOCK_TOPICS.length}`);
check("出现「换一批」", (await formState()).hasAnotherBatch, "");

const firstCardText = await page.evaluate(
  () => document.querySelector("[data-topic-card]")?.innerText ?? "",
);
check(
  "首条卡片是模型给的第一条选题",
  firstCardText.includes(MOCK_TOPICS[0].name) && firstCardText.includes("AI"),
  firstCardText.slice(0, 60),
);

// 选中第一条 → 表单预填
await page.locator("[data-topic-card]").first().click();
await page.waitForTimeout(300);
const filled = await formState();
check("书名已带出", filled.title === MOCK_TOPICS[0].name.split("·")[0], JSON.stringify(filled.title));
check("一句话故事 = 选题 seed", filled.logline === MOCK_TOPICS[0].seed, filled.logline.slice(0, 30));
check("故事简介已带出", filled.synopsis === MOCK_TOPICS[0].synopsis, filled.synopsis.slice(0, 30));
check("没有残留的错误提示", filled.error === "", filled.error);

// 创建 → 一句话成书
await page.click("text=创建并用 AI 建档");
await page.waitForTimeout(2500);
const url = page.url();
check("跳转到一句话成书", /\/p\/[^/]+\/genesis/.test(url), url);

const after = await formState();
check("成书页种子 = 选题 seed", after.seed === MOCK_TOPICS[0].seed, after.seed.slice(0, 40));

const project = await page.evaluate(async () => {
  const { listProjects } = await import("/src/db/repo/projects.ts");
  const list = await listProjects();
  const p = list[list.length - 1];
  return p
    ? { title: p.title, genres: p.genres, pov: p.pov, lengthClass: p.lengthClass, themes: p.themes }
    : null;
});
check("项目已落库", Boolean(project), JSON.stringify(project));
check("体裁来自选题", project?.genres.join("/") === MOCK_TOPICS[0].genres.join("/"), JSON.stringify(project?.genres));
check("视角来自选题", project?.pov === MOCK_TOPICS[0].pov, String(project?.pov));
check("篇幅来自选题", project?.lengthClass === MOCK_TOPICS[0].lengthClass, String(project?.lengthClass));
check("基调词进了主题", (project?.themes ?? []).join("/") === MOCK_TOPICS[0].toneKeywords.join("/"), JSON.stringify(project?.themes));

// ---------- 2. 失败路径：模型连不上，必须有可见报错 ----------
console.log("【AI 选题：模型不可用】");
await installProvider(DEAD);
await openAiPanel(BASE + "/new");
await page.fill('textarea[placeholder*="雾港"]', "随便写点");
await page.click("text=生成选题");

const errorText = await waitFor(
  page,
  () => document.querySelector("[data-ai-error]")?.innerText?.trim() || "",
  { timeout: 30000 },
);
check("失败时界面显示错误（不是静默失败）", errorText.length > 4, JSON.stringify(errorText));
check("失败后按钮回到可点状态", (await page.evaluate(() => document.body.innerText.includes("生成选题"))) === true);

// ---------- 3. 控制台 ----------
console.log("【控制台】");
const consoleNoise = errs.filter((e) => !e.includes("Failed to fetch") && !/ERR_CONNECTION|net::/i.test(e));
check("无控制台错误（失败路径的网络报错除外）", consoleNoise.length === 0, consoleNoise.slice(0, 3).join(" | "));

console.log("");
console.log(`结果：${pass} / ${pass + fail} 通过` + (fail ? `，${fail} 项失败` : "，全部通过"));
await context.close();
process.exit(fail ? 1 : 0);

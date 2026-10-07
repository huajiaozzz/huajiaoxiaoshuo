/**
 * 浏览器回归：多标签页编辑冲突 + 审稿报告导出（真下载）。
 *
 * 覆盖：
 * 1) 审稿台有导出按钮，点一次真的下载 MD 与 DOCX 两份
 * 2) 两个标签页同时写同一章 → 后保存的弹出对比框，三个选项齐全
 * 3) 选「保留我的」→ 保留自己那份，被放弃的那份进了快照
 * 4) 只是尾部追加 → **不弹窗**，自动合并（不打扰作者）
 *
 * 与 verify-conflict-ui.mjs 的分工：那一条测纯函数（判定与排版），
 * 这一条测真实交互与真实下载。两条都要 —— 纯函数全绿也可能整页白屏
 * （Modal 少包一层根就是这种后果，见 GOTCHAS）。
 */
import { gotoApp, launchIsolated } from "./lib/browser.mjs";

const BASE = "http://127.0.0.1:5178";
const context = await launchIsolated(import.meta.url, { viewport: { width: 1440, height: 950 } });
const page = context.pages()[0] ?? (await context.newPage());
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (x ? "  → " + x : "")); } };

// ---------- 建项目 + 章节 + 批注 ----------
console.log("【准备数据】");
await gotoApp(page, BASE + "/");
const seeded = await page.evaluate(async () => {
  const { db } = await import("/src/db/database.ts");
  const stamp = Date.now().toString(36);
  const pid = "prj_conf_" + stamp;
  const now = new Date().toISOString();
  await db.projects.put({
    id: pid, title: "冲突验证书", author: "测试", logline: "", synopsis: "",
    genres: [], tags: [], themes: [], forbidden: [], pov: "first", tense: "past",
    targetWords: 100000, targetChapterWords: 3000, lengthClass: "novel",
    status: "drafting", language: "zh-CN", stats: { words: 0, chapters: 1, scenes: 0, writingDays: 1 },
    createdAt: now, updatedAt: now,
  });
  const cid = "chp_conf_" + stamp;
  await db.chapters.put({
    id: cid, projectId: pid, arcId: undefined, title: "第一章", summary: "", goals: [],
    characterIds: [], locationIds: [], status: "drafting", wordCount: 8, tension: 0,
    plantsThreadIds: [], paysThreadIds: [], beats: [], tags: [], order: 0, createdAt: now, updatedAt: now,
  });
  await db.chapterContents.put({
    chapterId: cid, projectId: pid, html: "<p>起点甲乙丙丁戊己庚辛。</p>",
    text: "起点甲乙丙丁戊己庚辛。", updatedAt: now, rev: 1,
  });
  await db.comments.put({
    id: "cm_" + stamp, projectId: pid, chapterId: cid, author: "李编辑",
    body: "开场节奏可以再快一点。", anchor: { from: 0, to: 2, quote: "起点" },
    replies: [], resolved: false, kind: "note", createdAt: now, updatedAt: now,
  });
  return { pid, cid };
});
check("数据写入成功", Boolean(seeded.pid && seeded.cid));

// ---------- 审稿台导出按钮 ----------
console.log("");
console.log("【审稿台导出】");
await gotoApp(page, BASE + "/p/" + seeded.pid + "/review");
const hasBtn = await page.locator("[data-export-report]").count();
check("审稿台出现「导出审稿报告」按钮", hasBtn === 1, String(hasBtn));

// 真的点一次，看有没有下载两份文件
const names = [];
page.on("download", (d) => names.push(d.suggestedFilename()));
await page.locator("[data-export-report]").click();
await page.waitForTimeout(4000);
check("点击后下载了 Markdown", names.some((n) => n.endsWith(".md")), JSON.stringify(names));
check("点击后下载了 DOCX", names.some((n) => n.endsWith(".docx")), JSON.stringify(names));
if (names.length) {
  console.log("    下载文件：" + names.join(", "));
}

// ---------- 多标签页冲突 ----------
console.log("");
console.log("【多标签页冲突】");
const waitEditor = async (pg, needle) => {
  await pg.waitForFunction(
    (t) => (document.querySelector(".ProseMirror")?.innerText ?? "").includes(t),
    needle,
    { timeout: 20000 },
  );
};

const page2 = await context.newPage();
const page2errs = [];
page2.on("pageerror", (e) => page2errs.push(String(e.message).slice(0, 200)));
page2.on("console", (m) => { if (m.type() === "error") page2errs.push("console: " + m.text().slice(0, 160)); });
await gotoApp(page, BASE + "/p/" + seeded.pid + "/write/" + seeded.cid);
await waitEditor(page, "起点");
await gotoApp(page2, BASE + "/p/" + seeded.pid + "/write/" + seeded.cid);
await waitEditor(page2, "起点");

// 标签页 A 写"MyVersionA"并保存
await page.locator(".ProseMirror").click();
await page.keyboard.type("我的版本A");
await page.waitForTimeout(3000); // 等自动保存（默认 1200ms）

// 标签页 B 还在旧 rev 上，写别的内容并保存 → 应触发冲突
await page2.bringToFront();
await page2.locator(".ProseMirror").click();
await page2.keyboard.type("库里版本B");
await page2.waitForTimeout(3500);

// 诊断：两个标签页各自看到什么
const diag = await page.evaluate(async (cid) => {
  const { db } = await import("/src/db/database.ts");
  const c = await db.chapterContents.get(cid);
  return { text: c?.text, rev: c?.rev };
}, seeded.cid);
console.log("    库内容：", JSON.stringify(diag));
const bProbe = await page2.evaluate(() => {
  const pm = document.querySelector(".ProseMirror");
  return { mounted: Boolean(pm), bodyLen: document.body.innerText.length };
});
// 断言前先确认标签页真的活着：曾经因少包一层 Modal 根而整页白屏，
// 那种情况下所有后续断言会全部落空，且原因完全看不出来。
check("标签页 B 应用正常挂载（不是白屏）", bProbe.mounted && bProbe.bodyLen > 100, JSON.stringify(bProbe));
check("标签页 B 无控制台错误", page2errs.length === 0, page2errs.slice(0, 2).join(" | "));

const dialogVisible = await page2.locator("[role=dialog]").count();
const dialogText = dialogVisible ? await page2.locator("[role=dialog]").innerText().catch(() => "") : "";
check("冲突时弹出对比框", dialogVisible > 0, String(dialogVisible));
check("弹窗里有版本信息", /第\s*\d+\s*版/.test(dialogText), dialogText.slice(0, 160));
check("弹窗提供三个选择", dialogText.includes("保留我的") && dialogText.includes("用库里那版") && dialogText.includes("两版都保留"),
  dialogText.slice(0, 200));

// 选「保留我的」，并验证快照里留了另一版
if (dialogVisible > 0) {
  await page2.getByText("保留我的").click();
  await page2.waitForTimeout(1500);
  const after = await page.evaluate(async (cid) => {
    const { db } = await import("/src/db/database.ts");
    const content = await db.chapterContents.get(cid);
    const snaps = await db.snapshots.where("chapterId").equals(cid).toArray();
    return {
      text: content?.text ?? "",
      rev: content?.rev ?? 0,
      snapLabels: snaps.map((s) => s.label),
      snapTexts: snaps.map((s) => s.text),
    };
  }, seeded.cid);
  // 注意方向：现在操作的是**标签页 B**。
  // B 自己的正文是「…库里版本B」，库里（被 A 写过的）那份是「…我的版本A」。
  // 选「保留我的」= 保留 B 自己写的；被放弃、应存快照的是 A 那份。
  check("选择后保留了当前标签页自己的内容", after.text.includes("库里版本B"), after.text.slice(0, 80));
  check("被放弃的（A 写的那份）已存成快照", after.snapTexts.some((t) => t.includes("我的版本A")),
    JSON.stringify({ labels: after.snapLabels, texts: after.snapTexts.map((t) => t.slice(0, 30)) }));
  check("弹窗已关闭", (await page2.locator("[role=dialog]").count()) === 0);
} else {
  // 没弹窗就把当前库里的内容打出来，方便判断是自动合并了还是没触发
  const st = await page.evaluate(async (cid) => {
    const { db } = await import("/src/db/database.ts");
    const c = await db.chapterContents.get(cid);
    return { text: c?.text, rev: c?.rev };
  }, seeded.cid);
  console.log("    未弹窗，当前库内容：" + JSON.stringify(st));
}

console.log("");
console.log("控制台错误：" + (errs.length ? errs.slice(0, 5).join(" | ") : "无"));
check("无控制台错误", errs.length === 0, errs.slice(0, 3).join(" | "));


// ---------- 尾部追加：应自动合并，不弹窗 ----------
console.log("");
console.log("【尾部追加自动合并（不该打扰作者）】");
const p3 = await context.newPage();
await gotoApp(p3, BASE + "/p/" + seeded.pid + "/write/" + seeded.cid);
await p3.waitForFunction(() => (document.querySelector(".ProseMirror")?.innerText ?? "").length > 0, { timeout: 20000 });
await p3.bringToFront();
await p3.locator(".ProseMirror").click();
await p3.keyboard.press("End");
await p3.keyboard.type("尾部追加XYZ");
await p3.waitForTimeout(3200);
const merged = await p3.evaluate(async (cid) => {
  const { db } = await import("/src/db/database.ts");
  const c = await db.chapterContents.get(cid);
  return { text: c?.text ?? "", dialogs: document.querySelectorAll("[role=dialog]").length };
}, seeded.cid);
check("尾部追加没有弹窗（不打扰作者）", merged.dialogs === 0, String(merged.dialogs));
check("尾部追加内容已入库", merged.text.includes("尾部追加XYZ"), merged.text.slice(0, 60));

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
await context.close();
process.exit(fail === 0 ? 0 : 1);
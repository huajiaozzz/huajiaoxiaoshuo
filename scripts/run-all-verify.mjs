#!/usr/bin/env node
/**
 * 批量跑所有 `scripts/verify-*.mjs`，输出每个脚本的断言计数与失败项。
 *
 * 三类结果：
 *   ✓ 绿   —— 有断言汇总且 0 失败
 *   ○ 跳过 —— 打印了「跳过」且没跑断言（缺 DEEPSEEK_KEY / 代理 / Ollama 这类外部依赖）
 *   ✗ 红   —— 有失败项，或脚本崩了
 *
 * 断言汇总格式各家脚本不统一（「通过 12 / 12」「21 / 21 通过」「62 通过，0 失败」都出现过），
 * 这里三种都认 —— 只认一种会把绿的判成红。
 */
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dir = new URL('.', import.meta.url).pathname;
const scripts = readdirSync(dir).filter((f) => f.startsWith('verify-') && f.endsWith('.mjs')).sort();

const parseCounts = (out) => {
  const m =
    out.match(/通过\s*(\d+)\s*[/、]\s*(\d+)\s*通过/) ||
    out.match(/(\d+)\s*[/、]\s*(\d+)\s*通过/) ||
    out.match(/通过\s*(\d+)\s*项，失败\s*(\d+)\s*项/) ||
    out.match(/(\d+)\s*通过[，,]\s*(\d+)\s*失败/);
  return m ? { pass: +m[1], fail: +m[2] } : null;
};

const rows = [];
for (const s of scripts) {
  const started = Date.now();
  let out = '', code = 0;
  try {
    const r = await run('node', [dir + s], { cwd: dir + '..', timeout: 480000, maxBuffer: 8 * 1024 * 1024 });
    out = r.stdout + r.stderr;
  } catch (e) {
    code = e.code ?? 1;
    out = (e.stdout ?? '') + (e.stderr ?? '') + String(e.message ?? '');
  }
  const counts = parseCounts(out);
  const skipped = !counts && /跳过|缺少 .*环境变量|请先 npm run/.test(out);
  const fails = [...out.matchAll(/^\s*✗\s*(.+)$/gm)].map((m) => m[1].trim().slice(0, 130));
  const status = counts ? (counts.fail === 0 ? 'green' : 'red') : skipped ? 'skip' : code === 0 ? 'green' : 'red';
  rows.push({ script: s, status, counts, fails, code, secs: ((Date.now() - started) / 1000).toFixed(1) });
  const mark = { green: '✓', skip: '○', red: '✗' }[status];
  process.stdout.write(`${mark} ${s}  ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
}

console.log('\n================ 汇总 ================');
for (const r of rows) {
  const mark = { green: '✓', skip: '○ 跳过', red: '✗' }[r.status];
  const num = r.counts ? `通过 ${String(r.counts.pass).padStart(3)} / 失败 ${String(r.counts.fail).padStart(2)}` : '(无断言汇总)';
  console.log(`${mark} ${r.script.padEnd(34)} ${num}  （${r.secs}s）`);
  for (const f of r.fails) console.log(`      ✗ ${f}`);
}
const green = rows.filter((r) => r.status === 'green').length;
const skip = rows.filter((r) => r.status === 'skip').length;
const red = rows.filter((r) => r.status === 'red').length;
console.log(`\n共 ${rows.length} 个脚本：${green} 绿 / ${skip} 跳过 / ${red} 红`);
process.exit(red === 0 ? 0 : 1);

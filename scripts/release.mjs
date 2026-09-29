/**
 * 发版：把 src/core/changelog.ts 里的某个版本发成 GitHub Release（含 tag）。
 *
 * 为什么要有这个脚本：Release 的正文就是更新日志本身，手工复制进网页容易漏条目；
 * tag 还要打在「日志落地」的那笔提交上（而不是 HEAD），手工翻 sha 容易错。
 * 脚本一次把三件事做对：读 changelog 生成标题/正文 → 找落地提交 → gh release create。
 *
 * 用法：
 *   node scripts/release.mjs                     # 发 APP_VERSION（默认标为 Latest）
 *   node scripts/release.mjs 0.10.0              # 发指定版本
 *   node scripts/release.mjs 0.10.0 --dry-run    # 只打印标题/正文/tag sha，不真的发
 *   node scripts/release.mjs 0.10.0 --no-latest  # 不标记 Latest（补历史版本用）
 *   npm run release -- 0.9.0 --dry-run
 *
 * 前置：`gh auth status` 已登录；changelog 里有该版本条目。
 * 提醒：发完记得 push 提交，Release 页面与仓库状态才是同步的。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'https://github.com/qw1295353129/huajiaoxiaoshuo';
const KIND_LABEL = { added: '新增', improved: '优化', fixed: '修复' };

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const version = argv.find((a) => !a.startsWith('--'));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

const changelogUrl = pathToFileURL(
  join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'core', 'changelog.ts'),
).href;
const { CHANGELOG, APP_VERSION } = await import(changelogUrl);

const target = version ?? APP_VERSION;
const versions = CHANGELOG.map((r) => r.version);
const idx = versions.indexOf(target);
if (idx < 0) {
  console.error(`✗ changelog 里没有版本 ${target}；现有版本：${versions.join(', ')}`);
  process.exit(1);
}
const release = CHANGELOG[idx];
const prev = versions[idx + 1];

/* 标题与正文：与既有 Release（v0.6.0 起）的格式保持一致 */
const title = release.headline ? `v${release.version} — ${release.headline}` : `v${release.version}`;
let body = release.headline ? `${release.headline}\n` : '';
for (const c of release.changes) {
  body += `\n## ${KIND_LABEL[c.kind] ?? c.kind}\n`;
  for (const item of c.items) body += `- ${item}\n`;
}
body += `\n---\n\n**Full Changelog**: ${REPO}/compare/${prev ? `v${prev}` : `v${release.version}`}...v${release.version}\n`;

/* tag 打在「日志落地」的那笔提交上：第一条加入该版本条目的提交 */
const sha = git(
  'log', '--reverse', '--format=%H',
  '-S', `version: "${release.version}"`,
  '--', 'src/core/changelog.ts',
).split('\n')[0] ?? '';
if (!sha) {
  console.error('✗ 找不到该版本日志的落地提交（git log -S 无结果）');
  process.exit(1);
}

console.log(`版本   v${release.version}${release.date ? '（' + release.date + '）' : ''}`);
console.log(`标题   ${title}`);
console.log(`tag    v${release.version} → ${sha.slice(0, 7)}`);
console.log(`Latest ${flags.has('--no-latest') ? '否' : '是'}`);
console.log('----');
console.log(body);

if (flags.has('--dry-run')) {
  console.log('（dry-run，未发布）');
  process.exit(0);
}

/* 已存在就别重复发：Release 不能悄悄覆盖，改文案走 gh release edit */
try {
  gh('release', 'view', `v${release.version}`, '--json', 'tagName');
  console.error(`✗ v${release.version} 的 Release 已存在；改文案请用 gh release edit v${release.version}`);
  process.exit(1);
} catch {
  /* 不存在 = 可以发 */
}

const dir = mkdtempSync(join(tmpdir(), 'hj-release-'));
writeFileSync(join(dir, 'title'), title);
writeFileSync(join(dir, 'body.md'), body);

const args = ['release', 'create', `v${release.version}`, '--target', sha, '--title', title, '--notes-file', join(dir, 'body.md')];
if (!flags.has('--no-latest')) args.push('--latest');
const url = gh(...args);
console.log(`✓ 已发布：${url}`);

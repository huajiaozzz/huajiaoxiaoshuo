#!/usr/bin/env node
/**
 * 一键部署：本机推送 → （可选）发 Release → 服务器拉取构建 → 校验两端版本一致。
 *
 * 为什么要有它：发一次版要动三个地方（本地仓库、GitHub、服务器），
 * 手工来回切终端容易漏。这里把三步串起来，最后还会对比两端的 commit，
 * 不一致就明确报出来，不让你以为"推上去了"。
 *
 * 用法：
 *   npm run deploy                 # 推送 + 同步服务器
 *   npm run deploy -- --release    # 额外发一个 GitHub Release（版本取 APP_VERSION）
 *   npm run deploy -- --release 0.13.0
 *   npm run deploy -- --dry-run    # 只看要做什么，不执行
 *
 * 配置写在 .env.local（已被 .gitignore 挡住，不进仓库）：
 *   DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASSWORD / DEPLOY_PATH / DEPLOY_URL
 * 换成 SSH key 免密后，DEPLOY_PASSWORD 可以留空。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const versionArg = argv.find((a) => !a.startsWith('--'));
const DRY = flags.has('--dry-run');
const WITH_RELEASE = flags.has('--release');

/* ---------- 配置 ---------- */
function readEnvLocal() {
  const map = {};
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) map[m[1]] = m[2];
    }
  } catch {
    /* 没有这个文件就全用环境变量 */
  }
  return map;
}

const fileEnv = readEnvLocal();
const cfg = {
  host: process.env.DEPLOY_HOST ?? fileEnv.DEPLOY_HOST,
  user: process.env.DEPLOY_USER ?? fileEnv.DEPLOY_USER ?? 'root',
  password: process.env.DEPLOY_PASSWORD ?? fileEnv.DEPLOY_PASSWORD ?? '',
  path: process.env.DEPLOY_PATH ?? fileEnv.DEPLOY_PATH,
  url: process.env.DEPLOY_URL ?? fileEnv.DEPLOY_URL ?? '',
};

if (!cfg.host || !cfg.path) {
  console.error('✗ 缺少部署配置。请在 .env.local 里补上：');
  console.error('  DEPLOY_HOST=服务器地址');
  console.error('  DEPLOY_USER=root');
  console.error('  DEPLOY_PASSWORD=密码（配了 SSH key 可留空）');
  console.error('  DEPLOY_PATH=/服务器上的项目目录');
  console.error('  DEPLOY_URL=https://你的域名（可选，用于最后校验）');
  process.exit(1);
}

/* ---------- 小工具 ---------- */
const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败（exit ${res.status}）`);
};
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

/** 用 SSH_ASKPASS 喂密码，免得依赖 sshpass */
let askpassDir = null;
function askpassEnv() {
  const env = { ...process.env };
  if (!cfg.password) return env;
  if (!askpassDir) {
    askpassDir = mkdtempSync(join(tmpdir(), 'hj-deploy-'));
    const pwFile = join(askpassDir, 'pw');
    writeFileSync(pwFile, cfg.password + '\n', { mode: 0o600 });
    const askpass = join(askpassDir, 'askpass.sh');
    writeFileSync(askpass, `#!/bin/sh\ncat '${pwFile}'\n`);
    chmodSync(askpass, 0o700);
    env.SSH_ASKPASS = askpass;
    env.SSH_ASKPASS_REQUIRE = 'force';
    env.DISPLAY = ':0';
  }
  return env;
}

/** 跑一条远端命令；capture=true 时返回标准输出，否则直接透传到终端 */
function ssh(command, { capture = false } = {}) {
  const args = ['-o', 'StrictHostKeyChecking=no', `${cfg.user}@${cfg.host}`, command];
  const res = spawnSync('ssh', args, {
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 'inherit', 'inherit'],
    env: askpassEnv(),
    encoding: 'utf8',
  });
  if (capture) return { ok: res.status === 0, stdout: (res.stdout ?? '').trim() };
  return { ok: res.status === 0, stdout: '' };
}

/* ---------- 1. 本地：确认已推送 ---------- */
console.log('▶ 1/4 检查本地仓库');
const dirty = out('git', ['status', '--porcelain']);
if (dirty) {
  console.error('✗ 有未提交的改动，先提交再部署：\n' + dirty);
  process.exit(1);
}
const ahead = Number(out('git', ['rev-list', '--count', 'origin/main..main'])) || 0;
if (ahead > 0) {
  console.log(`  本地领先远端 ${ahead} 个提交，推送中…`);
  if (!DRY) run('git', ['push']);
} else {
  console.log('  已是最新，无需推送');
}
const localSha = out('git', ['rev-parse', '--short', 'HEAD']);

/* ---------- 2. GitHub Release（可选） ---------- */
console.log('▶ 2/4 GitHub Release');
if (WITH_RELEASE) {
  const args = ['scripts/release.mjs'];
  if (versionArg) args.push(versionArg);
  if (DRY) args.push('--dry-run');
  if (!DRY) run('node', args);
  else console.log('  （dry-run 跳过）');
} else {
  console.log('  跳过（要发就加 --release）');
}

/* ---------- 3. 服务器：拉取 + 构建 ---------- */
console.log('▶ 3/4 服务器拉取构建');
if (DRY) {
  console.log(`  （dry-run）会在 ${cfg.user}@${cfg.host}:${cfg.path} 执行 git pull + npm run build`);
} else {
  const remote = [
    `cd ${cfg.path}`,
    // npm install 会改写 lock，pull 前先还原，免得每次都要手工处理
    'git checkout -- package-lock.json 2>/dev/null || true',
    'git pull --ff-only',
    'npm run build',
  ].join(' && ');
  if (!ssh(remote).ok) {
    console.error('✗ 服务器同步失败，看看上面的输出');
    process.exit(1);
  }
}

/* ---------- 4. 校验：两端 commit 一致 ---------- */
console.log('▶ 4/4 校验');
if (DRY) {
  console.log('  （dry-run 结束）');
  process.exit(0);
}
const remote = ssh(`cd ${cfg.path} && git rev-parse --short HEAD`, { capture: true });
const remoteSha = remote.stdout.split('\n').pop();
console.log(`  本地 ${localSha} / 服务器 ${remoteSha}`);
if (!remote.ok || remoteSha !== localSha) {
  console.error('✗ 两端 commit 不一致，服务器可能没拉成功');
  process.exit(1);
}
if (cfg.url) {
  try {
    const res = await fetch(cfg.url, { redirect: 'follow' });
    console.log(`  线上可访问：HTTP ${res.status}`);
  } catch (e) {
    console.warn('  ⚠ 线上探测失败：' + (e instanceof Error ? e.message : String(e)));
  }
}
console.log('✓ 完成');

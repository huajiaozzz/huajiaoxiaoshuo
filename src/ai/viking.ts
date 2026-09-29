import type { ID, MemoryFact } from '@/core';
import { loadSettings } from '@/db/repo/settings';
import { resolveViking, type VikingSettings } from '@/core/settings';

export function vikingSettings(): VikingSettings {
  return resolveViking(loadSettings());
}

function headers(cfg: VikingSettings): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey?.trim()) h['X-API-Key'] = cfg.apiKey.trim();
  return h;
}

async function postJson<T>(url: string, cfg: VikingSettings, body: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

let lastError = '';

/** 面板里的"当前状态"那一行读它；只记录、不打扰 */
export function lastVikingError(): string {
  return lastError;
}

export async function probeViking(cfg: VikingSettings = vikingSettings()): Promise<{ ok: boolean; message: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(cfg.endpoint.replace(/\/$/, '') + '/health', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    lastError = '';
    return { ok: true, message: 'OpenViking 服务可用' };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { ok: false, message: '连不上 OpenViking（' + lastError + '），召回会走原来的链路' };
  }
}

const ROOT = (projectId: ID) => `viking://resources/huajiao/${projectId}/memories`;
const uriOf = (projectId: ID, factId: ID) => `${ROOT(projectId)}/${factId}.md`;

function factDoc(f: MemoryFact): string {
  return `# ${f.text}\n\n置信度 ${f.confidence}。${f.note ? '\n\n' + f.note : ''}\n`;
}

/**
 * 把本项目的记忆同步成 OpenViking 的资源文件（有则覆盖）。
 * 用 batch-write 一次推完、wait=false 不等索引；索引是异步的，
 * 刚同步完立刻搜可能少几条，下一次生成就有了。
 * 10 分钟内只同步一次 —— 每次生成都全量推太浪费。
 */
const SYNC_GAP_MS = 10 * 60 * 1000;
const lastSync = new Map<ID, number>();

export async function syncMemoriesToViking(projectId: ID, facts: MemoryFact[], cfg: VikingSettings): Promise<boolean> {
  if (!facts.length) return true;
  const now = Date.now();
  if (now - (lastSync.get(projectId) ?? 0) < SYNC_GAP_MS) return true;
  try {
    const base = cfg.endpoint.replace(/\/$/, '');
    const ops = facts.slice(0, 256).map((f) => ({ uri: uriOf(projectId, f.id), content: factDoc(f), mode: 'upsert' }));
    for (let i = 0; i < ops.length; i += 256) {
      await postJson(base + '/api/v1/content/batch-write', cfg, { root_uri: ROOT(projectId), operations: ops.slice(i, i + 256), wait: false }, 15000);
    }
    lastSync.set(projectId, now);
    lastError = '';
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

interface SearchEntry {
  uri?: string;
  score?: number;
  text?: string;
}

/**
 * 经 OpenViking 召回：按它的分级检索与目录定位打分，
 * 只取落在「本项目记忆目录」下的命中，按文件名（= 记忆 id）映射回候选。
 * 跨项目的命中会被 URI 前缀过滤掉，不会混进来。
 */
export async function recallViaViking(
  projectId: ID,
  query: string,
  facts: MemoryFact[],
  cfg: VikingSettings,
  topK: number,
): Promise<{ pickedIds: ID[]; note?: string }> {
  const ok = await syncMemoriesToViking(projectId, facts, cfg);
  if (!ok) return { pickedIds: [], note: '记忆同步到 OpenViking 失败（' + lastError + '），已退回原链路' };
  try {
    const base = cfg.endpoint.replace(/\/$/, '');
    const data = await postJson<{ status?: string; result?: { entries?: SearchEntry[] } }>(
      base + '/api/v1/search/search',
      cfg,
      { mode: 'context', query, score_threshold: 0.1, max_tokens: 2000 },
      20000,
    );
    const prefix = ROOT(projectId) + '/';
    const ids: ID[] = [];
    for (const e of data.result?.entries ?? []) {
      if (typeof e.uri !== 'string' || !e.uri.startsWith(prefix) || !e.uri.endsWith('.md')) continue;
      const id = e.uri.slice(prefix.length, -3);
      if (facts.some((f) => f.id === id) && !ids.includes(id)) ids.push(id);
      if (ids.length >= topK) break;
    }
    if (!ids.length) return { pickedIds: [], note: 'OpenViking 没有返回本项目的相关记忆，已退回原链路' };
    lastError = '';
    return { pickedIds: ids };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { pickedIds: [], note: 'OpenViking 检索失败（' + lastError + '），已退回原链路' };
  }
}

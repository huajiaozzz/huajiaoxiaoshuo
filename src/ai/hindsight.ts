import type { ID, MemoryFact } from '@/core';
import { loadSettings } from '@/db/repo/settings';
import { resolveHindsight, type HindsightSettings } from '@/core/settings';

export function hindsightSettings(): HindsightSettings {
  return resolveHindsight(loadSettings());
}

let lastError = '';

/** 面板里的"当前状态"那一行读它；只记录、不打扰 */
export function lastHindsightError(): string {
  return lastError;
}

function base(cfg: HindsightSettings): string {
  return cfg.apiUrl.replace(/\/$/, '');
}

function auth(cfg: HindsightSettings): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg.apiKey ?? '') };
}

/** 没填 key 或 bank 直接判不可用，不发请求 */
function configured(cfg: HindsightSettings): string | null {
  if (!cfg.apiKey?.trim()) return '还没填 API Key';
  if (!cfg.bankId?.trim()) return '还没填 bank id';
  return null;
}

export async function probeHindsight(cfg: HindsightSettings = hindsightSettings()): Promise<{ ok: boolean; message: string }> {
  const missing = configured(cfg);
  if (missing) return { ok: false, message: missing + '，填好后再测试' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(`${base(cfg)}/v1/default/banks/${cfg.bankId}/stats`, {
        headers: auth(cfg),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    lastError = '';
    return { ok: true, message: 'Hindsight 记忆库可用' };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { ok: false, message: '连不上 Hindsight（' + lastError + '），召回会走原来的链路' };
  }
}

/**
 * 本书记忆同步成一个文档（document_id 按项目固定，重复同步是覆盖不是追加）。
 * 10 分钟内只同步一次；云端索引异步，刚同步完立刻搜可能少几条。
 */
const SYNC_GAP_MS = 10 * 60 * 1000;
const lastSync = new Map<ID, number>();

export async function syncMemoriesToHindsight(projectId: ID, facts: MemoryFact[], cfg: HindsightSettings): Promise<boolean> {
  if (!facts.length || configured(cfg)) return false;
  const now = Date.now();
  if (now - (lastSync.get(projectId) ?? 0) < SYNC_GAP_MS) return true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const content = facts.map((f) => `- [${f.id}] ${f.text}`).join('\n');
      const res = await fetch(`${base(cfg)}/v1/default/banks/${cfg.bankId}/memories`, {
        method: 'POST',
        headers: auth(cfg),
        body: JSON.stringify({ items: [{ content, document_id: `huajiao:${projectId}` }] }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    lastSync.set(projectId, now);
    lastError = '';
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

interface RecallHit {
  text?: string;
  score?: number;
}

/**
 * 经 Hindsight 召回：命中按文本映射回候选记忆（同步时每条都带了 [id] 前缀）。
 * 对不上任何候选就当没命中，退回原链路。
 */
export async function recallViaHindsight(
  projectId: ID,
  query: string,
  facts: MemoryFact[],
  cfg: HindsightSettings,
  topK: number,
): Promise<{ pickedIds: ID[]; note?: string }> {
  if (configured(cfg)) return { pickedIds: [], note: 'Hindsight 还没配好（缺 Key 或 bank），已退回原链路' };
  const ok = await syncMemoriesToHindsight(projectId, facts, cfg);
  if (!ok) return { pickedIds: [], note: '记忆同步到 Hindsight 失败（' + (lastError || '未知') + '），已退回原链路' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let hits: RecallHit[] = [];
    try {
      const res = await fetch(`${base(cfg)}/v1/default/banks/${cfg.bankId}/memories/recall`, {
        method: 'POST',
        headers: auth(cfg),
        body: JSON.stringify({ query, max_tokens: 2000 }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { results?: RecallHit[] };
      hits = data.results ?? [];
    } finally {
      clearTimeout(timer);
    }
    const ids: ID[] = [];
    for (const h of hits) {
      if (typeof h.text !== 'string') continue;
      for (const f of facts) {
        if (!ids.includes(f.id) && (h.text.includes(`[${f.id}]`) || h.text.includes(f.text))) {
          ids.push(f.id);
          break;
        }
      }
      if (ids.length >= topK) break;
    }
    if (!ids.length) return { pickedIds: [], note: 'Hindsight 没有返回对得上的记忆，已退回原链路' };
    lastError = '';
    return { pickedIds: ids };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { pickedIds: [], note: 'Hindsight 检索失败（' + lastError + '），已退回原链路' };
  }
}

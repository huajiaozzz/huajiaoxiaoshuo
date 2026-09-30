import type { ID, MemoryFact } from '@/core';
import { loadSettings } from '@/db/repo/settings';
import { resolveHindsight, type HindsightSettings } from '@/core/settings';
import { detectProxy, getProxyBase, wrapWithProxy } from './proxy';

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
function missingConfig(cfg: HindsightSettings): string | null {
  if (!cfg.apiKey?.trim()) return '还没填 API Key';
  if (!cfg.bankId?.trim()) return '还没填 bank id';
  return null;
}

/** 把 HTTP 状态码翻成人话（官方错误码表） */
function explainStatus(status: number): string {
  if (status === 401) return 'API Key 无效或已过期（401）';
  if (status === 402) return '账户额度不足，去 Hindsight 后台充值（402）';
  if (status === 403) return '没有权限访问这个记忆库（403）';
  if (status === 404) return '记忆库不存在（404），检查 bank id 拼写';
  if (status === 400) return '请求内容不对（400）';
  if (status >= 500) return 'Hindsight 服务端出错（' + status + '），稍后重试';
  return 'HTTP ' + status;
}

async function call<T>(cfg: HindsightSettings, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const target = base(cfg) + path;
  // 云 API 不返回 CORS 头，浏览器直连会被拦（Failed to fetch）。
  // 本地代理在跑就走它转发，没跑就直连试试（自建/反代加了 CORS 头的情况能直连成功）。
  const proxy = await detectProxy();
  const url = proxy.available ? wrapWithProxy(getProxyBase(), target) : target;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, headers: auth(cfg), signal: ctrl.signal });
    if (!res.ok) throw new Error(explainStatus(res.status));
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('请求超时');
    // 直连失败且代理没开：把「该怎么办」直接写进错误里
    if (!proxy.available && e instanceof TypeError) {
      throw new Error('浏览器直连被拦（云 API 无 CORS）—— 先在本机跑 npm run proxy，再回来测试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeHindsight(cfg: HindsightSettings = hindsightSettings()): Promise<{ ok: boolean; message: string }> {
  const missing = missingConfig(cfg);
  if (missing) return { ok: false, message: missing + '，填好后再测试' };
  try {
    // 用一次最小 recall 探活：能返回就说明 key 和 bank 都对
    await call(cfg, `/v1/default/banks/${cfg.bankId}/memories/recall`, {
      method: 'POST',
      body: JSON.stringify({ query: 'ping', max_tokens: 64, budget: 'low' }),
    }, 12000);
    lastError = '';
    return { ok: true, message: 'Hindsight 记忆库可用' };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { ok: false, message: '连不上 Hindsight：' + lastError + '。召回会走原来的链路' };
  }
}

/**
 * 本书记忆同步成一篇文档（document_id 按项目固定，重复同步是覆盖不是追加）。
 * 按官方建议：内容用自然语言、一条一行；async 交给服务端后台抽取，不阻塞写作。
 * 10 分钟内只同步一次。
 */
const SYNC_GAP_MS = 10 * 60 * 1000;
const lastSync = new Map<ID, number>();

export async function syncMemoriesToHindsight(projectId: ID, facts: MemoryFact[], cfg: HindsightSettings): Promise<boolean> {
  if (!facts.length || missingConfig(cfg)) return false;
  const now = Date.now();
  if (now - (lastSync.get(projectId) ?? 0) < SYNC_GAP_MS) return true;
  try {
    const content = [
      '这本书的写作记忆（作者的偏好、教训、惯例、事实与洞察）：',
      ...facts.map((f) => `- ${f.text}${f.note ? '（' + f.note + '）' : ''}`),
    ].join('\n');
    await call(cfg, `/v1/default/banks/${cfg.bankId}/memories`, {
      method: 'POST',
      body: JSON.stringify({
        items: [{ content, context: '花椒写作平台的写作记忆，按项目分组' , document_id: `huajiao:${projectId}` }],
        async: true,
      }),
    }, 20000);
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
 * 经 Hindsight 召回：TEMPR 四路检索（语义/关键词/图/时间）后融合排序。
 * 命中按文本匹配回本地候选；一条都对不上就当没命中，退回原链路。
 */
export async function recallViaHindsight(
  projectId: ID,
  query: string,
  facts: MemoryFact[],
  cfg: HindsightSettings,
  topK: number,
): Promise<{ pickedIds: ID[]; note?: string }> {
  const missing = missingConfig(cfg);
  if (missing) return { pickedIds: [], note: 'Hindsight 还没配好（' + missing + '），已退回原链路' };
  const ok = await syncMemoriesToHindsight(projectId, facts, cfg);
  if (!ok) return { pickedIds: [], note: '记忆同步到 Hindsight 失败（' + (lastError || '未知') + '），已退回原链路' };
  try {
    const data = await call<{ results?: RecallHit[] }>(cfg, `/v1/default/banks/${cfg.bankId}/memories/recall`, {
      method: 'POST',
      // budget=mid 是官方默认；上限给到 topK 的两倍，多了也不要
      body: JSON.stringify({ query, budget: 'mid', max_tokens: 2048 }),
    }, 25000);
    const hits = data.results ?? [];
    // 按分数从高到低；只认能对回本地候选的那些
    const ids: ID[] = [];
    for (const h of [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
      const text = h.text;
      if (typeof text !== 'string') continue;
      const hit = facts.find((f) => !ids.includes(f.id) && (text.includes(f.text) || f.text.includes(text.trim())));
      if (hit) ids.push(hit.id);
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

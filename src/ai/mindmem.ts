import type { ID, MemoryFact } from '@/core';
import { loadSettings } from '@/db/repo/settings';
import { resolveMindMem, type MindMemSettings } from '@/core/settings';
import { detectSameOriginProxy, getForwardBase, wrapWithProxy } from './proxy';

export function mindmemSettings(): MindMemSettings {
  return resolveMindMem(loadSettings());
}

let lastError = '';

/** 面板里的"当前状态"那一行读它；只记录、不打扰 */
export function lastMindMemError(): string {
  return lastError;
}

/** 记忆归属的用户：默认按项目隔离，设置里能改成固定值跨书共用 */
function userOf(cfg: MindMemSettings, projectId: ID): string {
  return cfg.userId?.trim() || `huajiao:${projectId}`;
}

/** 把 HTTP 状态码翻成人话 */
function explainStatus(status: number): string {
  if (status === 401) return 'API Key 无效或没填（401）—— 去 mindmemos.cn 申请';
  if (status === 403) return '没有权限（403）';
  if (status === 404) return '接口不存在（404）—— 检查服务地址';
  if (status === 429) return '请求太频繁（429），稍后再试';
  if (status >= 500) return 'MindMemOS 服务端出错（' + status + '）';
  return 'HTTP ' + status;
}

/**
 * 统一请求：自带鉴权头，走代理（官方云不支持 CORS 预检，浏览器直连必被拦）。
 */
async function call<T>(cfg: MindMemSettings, path: string, body: unknown, timeoutMs: number): Promise<T> {
  await detectSameOriginProxy();
  const url = wrapWithProxy(getForwardBase(), cfg.endpoint.replace(/\/$/, '') + path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (cfg.apiKey ?? ''),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(explainStatus(res.status));
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('请求超时');
    if (e instanceof TypeError) {
      throw new Error('转发没打通（' + getForwardBase() + '）—— 确认本地代理在跑，或换个网络试试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeMindMem(cfg: MindMemSettings = mindmemSettings()): Promise<{ ok: boolean; message: string }> {
  if (!cfg.apiKey?.trim()) return { ok: false, message: '还没填 API Key，去 mindmemos.cn 官网申请' };
  try {
    // 一次空搜索探活：能返回就说明地址和 key 都对
    await call(cfg, '/v1/memory/search', { query: 'ping', top_k: 1 }, 12000);
    lastError = '';
    return { ok: true, message: 'MindMemOS 记忆库可用' };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { ok: false, message: '连不上 MindMemOS：' + lastError + '。召回会走原来的链路' };
  }
}

/**
 * 把本书记忆同步过去（一次批量写入，10 分钟内只同步一次）。
 * 官方会从消息里抽取记忆并自己去重合并，所以这里直接喂原文即可。
 */
const SYNC_GAP_MS = 10 * 60 * 1000;
const lastSync = new Map<ID, number>();

export async function syncMemoriesToMindMem(projectId: ID, facts: MemoryFact[], cfg: MindMemSettings): Promise<boolean> {
  if (!facts.length) return false;
  const now = Date.now();
  if (now - (lastSync.get(projectId) ?? 0) < SYNC_GAP_MS) return true;
  try {
    // 每条记忆作为一条 user 消息喂进去，官方从中抽取结构化记忆
    const messages = facts.map((f) => ({
      role: 'user' as const,
      content: `[${f.id}] ${f.text}${f.note ? '（' + f.note + '）' : ''}`,
    }));
    await call(cfg, '/v1/memory/add', { user_id: userOf(cfg, projectId), messages, mode: 'sync' }, 30000);
    lastSync.set(projectId, now);
    lastError = '';
    return true;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return false;
  }
}

/** 兼容几种可能的返回形状，取到记忆文本数组 */
function pickMemories(raw: unknown): { id?: string; text: string; score?: number }[] {
  const root = raw as Record<string, unknown> | null;
  if (!root) return [];
  const data = (root.data ?? root) as Record<string, unknown>;
  const list = (data.memories ?? data.results ?? data.items ?? []) as unknown[];
  if (!Array.isArray(list)) return [];
  const out: { id?: string; text: string; score?: number }[] = [];
  for (const it of list) {
    const o = it as Record<string, unknown>;
    const text = (o.memory ?? o.content ?? o.text ?? o.summary) as string | undefined;
    if (typeof text === 'string' && text) {
      out.push({ id: o.id as string | undefined, text, score: o.score as number | undefined });
    }
  }
  return out;
}

/**
 * 经 MindMemOS 召回：语义检索回来，按文本映射回本地候选。
 * 一条都对不上就当没命中，退回原链路。
 */
export async function recallViaMindMem(
  projectId: ID,
  query: string,
  facts: MemoryFact[],
  cfg: MindMemSettings,
  topK: number,
): Promise<{ pickedIds: ID[]; note?: string }> {
  if (!cfg.apiKey?.trim()) return { pickedIds: [], note: 'MindMemOS 还没填 API Key，已退回原链路' };
  const ok = await syncMemoriesToMindMem(projectId, facts, cfg);
  if (!ok) return { pickedIds: [], note: '记忆同步到 MindMemOS 失败（' + (lastError || '未知') + '），已退回原链路' };
  try {
    const data = await call<unknown>(cfg, '/v1/memory/search', {
      user_id: userOf(cfg, projectId),
      query,
      top_k: Math.max(topK, 10),
      search_strategy: 'fast',
    }, 25000);
    const hits = pickMemories(data);
    const ids: ID[] = [];
    for (const h of hits) {
      // 同步时带了 [id] 前缀，优先按它映射；没有就按文本包含关系找
      const byTag = /\[([a-z0-9_]+)\]/i.exec(h.text)?.[1];
      const hit =
        facts.find((f) => !ids.includes(f.id) && (f.id === byTag || h.text.includes(f.text))) ?? null;
      if (hit) ids.push(hit.id);
      if (ids.length >= topK) break;
    }
    if (!ids.length) return { pickedIds: [], note: 'MindMemOS 没有返回对得上的记忆，已退回原链路' };
    lastError = '';
    return { pickedIds: ids };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { pickedIds: [], note: 'MindMemOS 检索失败（' + lastError + '），已退回原链路' };
  }
}

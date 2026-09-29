import { loadSettings } from '@/db/repo/settings';
import { resolveLaya, type LayaSettings } from '@/core/settings';

export function layaSettings(): LayaSettings {
  return resolveLaya(loadSettings());
}

let lastError = '';

/** 面板里的"当前状态"那一行读它；只记录、不打扰 */
export function lastLayaError(): string {
  return lastError;
}

export async function probeLaya(cfg: LayaSettings = layaSettings()): Promise<{ ok: boolean; message: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(cfg.endpoint.replace(/\/$/, '') + '/health', { signal: ctrl.signal });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    lastError = '';
    return { ok: true, message: 'Laya 决策服务可用' };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return { ok: false, message: '连不上 Laya（' + lastError + '），判定会走原来的固定值' };
  }
}

/**
 * 结构化判定：把 state 按 JSON schema 判出类型化结果。
 * 返回 null = 不可用，调用方必须有 fallback（固定值），不能把生成卡住。
 */
export async function decideLaya<T>(
  state: Record<string, unknown>,
  schema: Record<string, unknown>,
  cfg: LayaSettings = layaSettings(),
  timeoutMs = 60000,
): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(cfg.endpoint.replace(/\/$/, '') + '/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, schema }),
        signal: ctrl.signal,
      });
      const data = (await res.json()) as { ok?: boolean; result?: T; error?: string };
      if (!res.ok || !data.ok || data.result == null) throw new Error(data.error ?? `HTTP ${res.status}`);
      lastError = '';
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

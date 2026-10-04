import { APP_VERSION } from '@/core/changelog';

const RELEASES_URL = 'https://api.github.com/repos/huajiaozzz/huajiaoxiaoshuo/releases/latest';
const RELEASE_PAGE = 'https://github.com/huajiaozzz/huajiaoxiaoshuo/releases';

export interface UpdateInfo {
  available: boolean;
  current: string;
  latest: string;
  url: string;
  /** 拿不到远端信息时的原因，只给界面看，不打扰 */
  note?: string;
}

function parseTag(tag: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(latest: string, current: string): boolean {
  const l = parseTag(latest);
  const c = parseTag(current);
  if (!l || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (l[i] !== c[i]) return l[i] > c[i];
  }
  return false;
}

/**
 * 检查更新：问 GitHub Releases 有没有比当前新的版本。
 * 失败（断网、限流）一律静默，返回 available=false + note，
 * 调用方只在"有新版"时才打扰用户。
 */
export async function checkForUpdate(timeoutMs = 8000): Promise<UpdateInfo> {
  const current = APP_VERSION;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = (data.tag_name ?? '').replace(/^v/, '');
      if (!latest) throw new Error('版本号为空');
      return {
        available: isNewer(latest, current),
        current,
        latest,
        url: data.html_url ?? RELEASE_PAGE,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return {
      available: false,
      current,
      latest: current,
      url: RELEASE_PAGE,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

export function releasesPage(): string {
  return RELEASE_PAGE;
}

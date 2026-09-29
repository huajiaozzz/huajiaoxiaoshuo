import type { ID, WorldCategory } from '@/core';
import { db } from '@/db/database';
import { loadSettings } from '@/db/repo/settings';
import { resolveAutoExtract } from '@/core/settings';
import { extractFromChapter, applyExtraction } from './extract';
import { createWorldEntry, listWorldEntries } from '@/db/repo/world';
import { listCharacters } from '@/db/repo/cast';
import { refreshKnowledge } from '@/db/repo/knowledge';
import { countWords } from '@/utils/text';

export type NotifyFn = (kind: 'info' | 'success' | 'warning' | 'danger', text: string, detail?: string) => void;

/**
 * 保存后自动抽取：写完不用再去点"抽取"，新增的人物 / 世界观 / 伏笔 / 时间线自己入库。
 *
 * 节流两道：自上次抽取新增字数不够（默认 800）不跑；15 分钟内跑过不跑。
 * 失败（没配模型、没激活、超时）一律静默跳过 —— 自动保存不能因为抽取卡住，更不能弹窗打断写作。
 * 唯一可见的痕迹是成功后的一条通知。
 */
const INTERVAL_MS = 15 * 60 * 1000;
const STATE_KEY = 'huajiao:autoextract';

interface ExtractState {
  words: number;
  at: number;
}

function readState(chapterId: ID): ExtractState {
  try {
    return (JSON.parse(localStorage.getItem(STATE_KEY + ':' + chapterId) ?? '')) as ExtractState;
  } catch {
    return { words: 0, at: 0 };
  }
}

function writeState(chapterId: ID, s: ExtractState): void {
  try {
    localStorage.setItem(STATE_KEY + ':' + chapterId, JSON.stringify(s));
  } catch {
    /* 配额满了也不影响写作 */
  }
}

/** 名词转世界观条目：只有指向明确的几类才转，剩下的留在名词表走"未确认实体"流程 */
const ENTITY_TO_CATEGORY: Record<string, WorldCategory> = {
  location: 'geography',
  faction: 'organization',
  item: 'item',
  creature: 'species',
};

export async function maybeAutoExtract(projectId: ID, chapterId: ID, notify: NotifyFn): Promise<void> {
  const cfg = resolveAutoExtract(loadSettings());
  if (!cfg.enabled) return;

  const content = await db.chapterContents.get(chapterId);
  const chapter = await db.chapters.get(chapterId);
  if (!content || !chapter) return;
  const words = countWords(content.text || content.html);
  const prev = readState(chapterId);
  if (words - prev.words < cfg.minNewWords) return;
  if (Date.now() - prev.at < INTERVAL_MS) return;
  // 先记下，避免抽取失败导致下次保存又重试一次
  writeState(chapterId, { words, at: Date.now() });

  const res = await extractFromChapter(projectId, chapterId);
  if (!res.ok || !res.bundle) return;
  const applied = await applyExtraction(projectId, chapterId, res.bundle);

  // 名词里指向明确的（地点 / 组织 / 物品 / 生物）顺手建成世界观条目，同名跳过
  let worldBuilt = 0;
  const existing = await listWorldEntries(projectId);
  const titles = new Set<string>();
  for (const e of existing) {
    titles.add(e.title);
    for (const a of e.aliases) titles.add(a);
  }
  for (const e of res.bundle.entities) {
    const category = ENTITY_TO_CATEGORY[e.kind];
    if (!category || !e.name || titles.has(e.name)) continue;
    await createWorldEntry(projectId, {
      title: e.name,
      category,
      body: e.summary || '',
      tags: ['自动抽取'],
      importance: 3,
    });
    titles.add(e.name);
    worldBuilt += 1;
  }

  // 抽到的人物补上本章出场（已有出场的不动，只补缺的）
  const chars = await listCharacters(projectId);
  const byName = new Map(chars.flatMap((c) => [[c.name, c], ...c.aliases.map((a) => [a, c] as const)]));
  const rows = await db.characterAppearances.where('chapterId').equals(chapterId).toArray();
  const seen = new Set(rows.map((r) => r.characterId));
  const missing = res.bundle.characters
    .map((c) => byName.get(c.name)?.id)
    .filter((id): id is ID => !!id && !seen.has(id));
  if (missing.length) {
    await db.characterAppearances.bulkPut(
      missing.map((characterId) => ({ id: `${characterId}::${chapterId}`, characterId, chapterId, mentioned: 0, dialogueLines: 0, words: 0 })),
    );
  }

  // 知识页顺手刷新，免得人物小传 / 世界观总览里看不到刚抽到的
  try {
    await Promise.all([
      refreshKnowledge(projectId, 'characters'),
      refreshKnowledge(projectId, 'world'),
      refreshKnowledge(projectId, 'threads'),
    ]);
  } catch {
    /* 知识页刷新失败不影响抽取结果 */
  }

  const parts: string[] = [];
  if (applied.characters) parts.push(applied.characters + ' 个人物');
  if (worldBuilt) parts.push(worldBuilt + ' 条世界观');
  if (applied.threads) parts.push(applied.threads + ' 条伏笔');
  if (applied.timeline) parts.push(applied.timeline + ' 个事件');
  if (applied.relationships) parts.push(applied.relationships + ' 条关系');
  if (applied.glossary) parts.push(applied.glossary + ' 个名词写法');
  if (!parts.length) return;
  notify('success', `第${chapter.order + 1}章自动抽取入库`, parts.join('、'));
}

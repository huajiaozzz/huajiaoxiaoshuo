import type { ID, KnowledgeKind, KnowledgePage } from '@/core';
import { db } from '../database';
import { newId } from '@/utils/id';
import { listCharacters, listRelationships, listAppearances } from './cast';
import { listWorldEntries } from './world';
import { listThreads } from './story';
import { WORLD_CATEGORY_LABELS } from '@/db/defaults';
import { THREAD_STATUS_LABELS } from '@/features/threads/threadMeta';
import { ROLE_LABEL } from '@/features/characters/meta';

export const KNOWLEDGE_KINDS: KnowledgeKind[] = ['characters', 'world', 'threads'];

export async function getKnowledgePage(projectId: ID, kind: KnowledgeKind): Promise<KnowledgePage | undefined> {
  return db.knowledgePages.where('[projectId+kind]').equals([projectId, kind]).first();
}

/** 简单指纹：源数据变了就变，用于"已过期"判定 */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function buildCharacters(projectId: ID): Promise<{ content: string; fingerprint: string }> {
  const chars = await listCharacters(projectId);
  const rels = await listRelationships(projectId);
  const byId = new Map(chars.map((c) => [c.id, c]));
  const lines = [`# 人物小传（${chars.length} 人）`, ''];
  for (const c of chars) {
    const apps = await listAppearances(c.id);
    const linked = rels.filter((r) => r.fromId === c.id || r.toId === c.id);
    lines.push(`## ${c.name}${c.tagline ? ' —— ' + c.tagline : ''}`);
    const meta = [`定位 ${ROLE_LABEL[c.role] ?? c.role}`, `出场 ${apps.length} 章`];
    if (c.aliases?.length) meta.push(`别名 ${c.aliases.join(' / ')}`);
    lines.push(meta.join(' · '));
    if (c.background) lines.push('', c.background);
    if (c.want) lines.push('', `想要：${c.want}` + (c.need ? `；需要：${c.need}` : ''));
    if (c.arc) lines.push('', `弧光：${c.arc}`);
    if (linked.length) {
      lines.push('', '关系：' + linked.map((r) => {
        const other = byId.get(r.fromId === c.id ? r.toId : r.fromId);
        return `${other?.name ?? '?'}（${r.kind}${r.visibility === 'secret' ? '·密' : ''}）`;
      }).join('；'));
    }
    lines.push('');
  }
  const content = lines.join('\n');
  return { content, fingerprint: hash(JSON.stringify(chars) + JSON.stringify(rels)) };
}

async function buildWorld(projectId: ID): Promise<{ content: string; fingerprint: string }> {
  const entries = await listWorldEntries(projectId);
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = groups.get(e.category) ?? [];
    list.push(e);
    groups.set(e.category, list);
  }
  const lines = [`# 世界观总览（${entries.length} 条）`, ''];
  for (const [cat, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${WORLD_CATEGORY_LABELS[cat] ?? cat}（${list.length}）`, '');
    for (const e of list.sort((a, b) => b.importance - a.importance)) {
      lines.push(`- **${e.title}** ${'★'.repeat(Math.max(0, Math.min(5, e.importance)))}`);
      if (e.body) lines.push(`  ${e.body.slice(0, 120)}${e.body.length > 120 ? '…' : ''}`);
    }
    lines.push('');
  }
  const content = lines.join('\n');
  return { content, fingerprint: hash(JSON.stringify(entries)) };
}

async function buildThreads(projectId: ID): Promise<{ content: string; fingerprint: string }> {
  const threads = await listThreads(projectId);
  const lines = [`# 伏笔总览（${threads.length} 条）`, ''];
  for (const t of threads) {
    lines.push(`## ${t.title}（${THREAD_STATUS_LABELS[t.status] ?? t.status} · ${t.priority}）`);
    if (t.description) lines.push(t.description);
    const bits = [];
    if (t.plantQuote) bits.push(`埋设：「${t.plantQuote.slice(0, 60)}」`);
    if (t.payoffQuote) bits.push(`回收：「${t.payoffQuote.slice(0, 60)}」`);
    if (t.lastSeenChapterOrder != null) bits.push(`上次出现第 ${t.lastSeenChapterOrder} 章`);
    if (bits.length) lines.push('', ...bits);
    lines.push('');
  }
  const content = lines.join('\n');
  return { content, fingerprint: hash(JSON.stringify(threads)) };
}

const BUILDERS: Record<KnowledgeKind, (projectId: ID) => Promise<{ content: string; fingerprint: string }>> = {
  characters: buildCharacters,
  world: buildWorld,
  threads: buildThreads,
};

/** 组装（不存）：返回内容与指纹，调用方决定存不存 */
export async function buildKnowledge(projectId: ID, kind: KnowledgeKind): Promise<{ content: string; fingerprint: string }> {
  return BUILDERS[kind](projectId);
}

/** 当前存的页是否过期：源数据变了就过期 */
export async function isKnowledgeStale(projectId: ID, kind: KnowledgeKind): Promise<boolean> {
  const [page, fresh] = await Promise.all([getKnowledgePage(projectId, kind), buildKnowledge(projectId, kind)]);
  if (!page) return true;
  return page.sourceHash !== fresh.fingerprint;
}

/** 重新组装并存下，返回存好的页 */
export async function refreshKnowledge(projectId: ID, kind: KnowledgeKind): Promise<KnowledgePage> {
  const { content, fingerprint } = await buildKnowledge(projectId, kind);
  const now = new Date().toISOString();
  const existing = await getKnowledgePage(projectId, kind);
  const page: KnowledgePage = {
    id: existing?.id ?? newId('knw'),
    projectId,
    kind,
    content,
    sourceHash: fingerprint,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.knowledgePages.put(page);
  return page;
}

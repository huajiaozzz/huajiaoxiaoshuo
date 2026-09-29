import type { ID, Timestamped } from './base';

/** 知识页种类：人物小传 / 世界观总览 / 伏笔总览 */
export type KnowledgeKind = 'characters' | 'world' | 'threads';

export const KNOWLEDGE_LABEL: Record<KnowledgeKind, string> = {
  characters: '人物小传',
  world: '世界观总览',
  threads: '伏笔总览',
};

export interface KnowledgePage extends Timestamped {
  id: ID;
  projectId: ID;
  kind: KnowledgeKind;
  /** 渲染用的 Markdown，由源数据组装，不是手写正文 */
  content: string;
  /** 源数据指纹：打开时重算，不一致就标"已过期" */
  sourceHash: string;
}

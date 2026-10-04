import type { UserTemplateRecord } from "@/core";
import type { ChapterPlaybookEntry, NovelTemplate } from "@/core";
import { db } from "../database";
import { newId } from "@/utils/id";

/**
 * 用户模板库：整本拆书自动入库的模板。
 *
 * 与内置模板（src/core/templates.ts，写死、离线）相对 —— 这里存的是作者自己拆出来的。
 * template 字段保持 NovelTemplate 形状，新建作品弹窗里的 TemplatePicker 可以直接消费，
 * 不用为「拆出来的模板」单独走一套预填逻辑。
 */

/** 库容上限：一份模板内嵌技法与配方，体积不大，但也没必要无限攒 */
export const MAX_USER_TEMPLATES = 30;

export async function listUserTemplates(): Promise<UserTemplateRecord[]> {
  const rows = await db.userTemplates.toArray();
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function saveUserTemplate(input: {
  name: string;
  emoji?: string;
  sourceTitle: string;
  bookWords: number;
  template: NovelTemplate;
  playbook: ChapterPlaybookEntry[];
  techniqueDigest: string;
}): Promise<UserTemplateRecord> {
  const now = new Date().toISOString();
  // template.id 与记录 id 保持一致：TemplatePicker 的选中态就是靠 template.id 对上的
  const id = newId("ut");
  const row: UserTemplateRecord = {
    id,
    name: input.name.trim() || "未命名模板",
    emoji: input.emoji || "📖",
    sourceTitle: input.sourceTitle,
    bookWords: input.bookWords,
    template: { ...input.template, id },
    playbook: input.playbook,
    techniqueDigest: input.techniqueDigest,
    createdAt: now,
    updatedAt: now,
  };
  await db.userTemplates.put(row);
  return row;
}

export async function deleteUserTemplate(id: string): Promise<void> {
  await db.userTemplates.delete(id);
}

export async function pruneUserTemplates(keep = MAX_USER_TEMPLATES): Promise<number> {
  const rows = await listUserTemplates();
  const extra = rows.slice(keep);
  for (const r of extra) await db.userTemplates.delete(r.id);
  return extra.length;
}

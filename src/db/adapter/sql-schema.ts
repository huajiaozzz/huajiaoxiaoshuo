/**
 * SQLite 表结构：从 Dexie 的 `DB_STORES` **推**出来，不手写第二份。
 *
 * ## 为什么要推而不是手写
 *
 * 手写 SQL schema 就等于把表结构抄了第二遍。加一张表时漏抄一处，
 * 症状是"桌面端某个页面数据不见了"——而 Web 端（走 Dexie）完全正常，
 * 排查起来极其痛苦。抄本迟早会漂。
 *
 * `DB_STORES` 已经是唯一的结构声明（Dexie 自己也靠它建索引），
 * 这里只是换一种方言读它。
 *
 * ## 行怎么存
 *
 * 领域模型里有大量嵌套结构（`anchor: {from,to,quote}`、`aliases: string[]`…），
 * 拆成几十个列既慢又脆（加字段要改 schema + 改映射）。
 * 所以用「文档 + 索引列」：
 *   - `data` 列存整行 JSON（真实数据，永远完整）
 *   - `DB_STORES` 里声明的字段额外存成**真实列**，只为让 `WHERE` 能走索引
 *
 * 查询只按索引列过滤，读出来再 `JSON.parse(data)`。
 *
 * ## 值的映射
 *
 * SQLite 只有 NULL / INTEGER / REAL / TEXT / BLOB。领域模型里有 boolean、
 * number、string，以及少量被索引的数组/对象：
 *   null/undefined → NULL；boolean → 0/1；number → REAL；其余 → TEXT（对象数组存 JSON）
 * 布尔存成 0/1 而非 'true'，否则 `WHERE resolved = 0` 匹配不上。
 */

import { DB_STORES, DB_VERSION } from '../schema';

export interface CompoundIndex {
  /** 形如 'projectId+kind' */
  fields: string[];
  /** 传给 where() 的键，形如 '[projectId+kind]' */
  key: string;
}

export interface TableSchema {
  name: string;
  /** 主键字段名（Dexie 索引串里的第一个） */
  primaryKey: string;
  /** 单列索引字段 */
  indexes: string[];
  /** 复合索引 */
  compounds: CompoundIndex[];
}

/** 拆 Dexie 的索引串：'id, title, [projectId+order]' → 主键 id + 索引 */
export function parseStoreSpec(name: string, spec: string): TableSchema {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const primaryKey = parts[0] ?? 'id';
  const indexes: string[] = [];
  const compounds: CompoundIndex[] = [];
  for (const p of parts.slice(1)) {
    if (p.startsWith('[') && p.endsWith(']')) {
      const fields = p.slice(1, -1).split('+').map((s) => s.trim()).filter(Boolean);
      if (fields.length >= 2) compounds.push({ fields, key: p });
      else if (fields.length === 1) indexes.push(fields[0]);
    } else if (p !== '*') {
      indexes.push(p);
    }
  }
  return { name, primaryKey, indexes, compounds };
}

/** 全部表结构 */
export const TABLE_SCHEMAS: TableSchema[] = Object.entries(DB_STORES).map(([name, spec]) =>
  parseStoreSpec(name, spec),
);

export const TABLE_NAMES = TABLE_SCHEMAS.map((t) => t.name);

const SCHEMA_BY_NAME = new Map(TABLE_SCHEMAS.map((t) => [t.name, t]));

export function tableSchema(name: string): TableSchema | undefined {
  return SCHEMA_BY_NAME.get(name);
}

/** 标识符加引号：表名/列名可能含 SQL 关键字，且一律来自我们自己声明的常量 */
export function qi(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

/** 建表 + 建索引的 DDL（幂等：全部 IF NOT EXISTS） */
export function buildDdl(): string[] {
  const out: string[] = [];
  for (const t of TABLE_SCHEMAS) {
    const cols = [qi(t.primaryKey) + ' TEXT PRIMARY KEY', qi('data') + ' TEXT NOT NULL'];
    // 索引列：列名与 JSON 里字段同名，读取时不需要做任何映射
    for (const idx of [...t.indexes, ...t.compounds.flatMap((c) => c.fields)]) {
      if (idx === t.primaryKey) continue;
      if (cols.some((c) => c.startsWith(qi(idx) + ' '))) continue;
      cols.push(qi(idx) + ' TEXT');
    }
    out.push('CREATE TABLE IF NOT EXISTS ' + qi(t.name) + ' (\n  ' + cols.join(',\n  ') + '\n);');
    for (const idx of t.indexes) {
      if (idx === t.primaryKey) continue;
      out.push('CREATE INDEX IF NOT EXISTS ' + qi('ix_' + t.name + '_' + idx) + ' ON ' + qi(t.name) + ' (' + qi(idx) + ');');
    }
    for (const c of t.compounds) {
      out.push(
        'CREATE INDEX IF NOT EXISTS ' + qi('ix_' + t.name + '_' + c.fields.join('_')) +
          ' ON ' + qi(t.name) + ' (' + c.fields.map(qi).join(', ') + ');',
      );
    }
  }
  return out;
}

/** 记录当前 schema 版本，用 user_version PRAGMA 存 */
export const SCHEMA_VERSION = DB_VERSION;

/** 用户版本表的建表与写入 */
export function buildMetaDdl(): string[] {
  return [
    'CREATE TABLE IF NOT EXISTS "__meta" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);',
    'PRAGMA user_version = ' + SCHEMA_VERSION + ';',
  ];
}

/**
 * 把一行领域对象拆成「索引列 + JSON」。
 *
 * 索引用 TEXT 存，所以标量统一转字符串：数字 3 存成 '3'。
 * 查询侧也按字符串比，两边一致即可。
 */
export function toRow(schema: TableSchema, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { data: JSON.stringify(row) };
  out[schema.primaryKey] = String(row[schema.primaryKey] ?? '');
  const fields = [...schema.indexes, ...schema.compounds.flatMap((c) => c.fields)];
  for (const f of fields) {
    if (f === schema.primaryKey) continue;
    out[f] = encodeIndexValue((row as Record<string, unknown>)[f]);
  }
  return out;
}

/** 索引值的编码：与 toRow 成对，null/undefined 存 NULL */
export function encodeIndexValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  // 数组/对象被声明成索引时只能存 JSON 文本（查询侧同样式编码）
  return JSON.stringify(v);
}
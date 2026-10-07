/**
 * SQLite 存储后端：对上伪装成 Dexie，对下走 SQL。
 *
 * ## 为什么要伪装成 Dexie 而不是改所有调用方
 *
 * 全项目 23 个文件直接用 `db.*`（`src/ai` 11 个、`src/features` 4 个、
 * `src/db` 内部若干）。如果换后端就改调用签名，要动 23 个文件、上百处，
 * 而且**Web 端还得继续跑 Dexie** —— 两套调用写法长期并存本身就是 bug 温床。
 *
 * 现在的做法：只换 `db` 这个对象本身，实现**同一套方法形状**，
 * 业务代码一行不改。Web 端拿 Dexie 实例，桌面端拿这里的实现。
 * 风险集中在**一个文件**，而不是散在 23 处。
 *
 * ## 唯一的类型谎言
 *
 * `database.ts` 导出时把这个实现 cast 成 Dexie 的类型。原因同上：
 * 让 23 个文件保留完整的 Dexie 类型推导。代价是**类型系统不再校验这条路径** ——
 * 所以这里的每个方法都必须在 `verify-sqlite-adapter.mjs` 里有对应断言，
 * 类型能骗过人，断言骗不了。
 *
 * ## 形状与 Dexie 的两处刻意的不同
 *
 * 1. `.where(f).equals(v)` 返回的是**延迟查询对象**，不是立即查库。
 *    真正的 SQL 在终止方法（toArray / modify / delete / count / first…）
 *    被调用时才发出去。链式调用看起来一样，但所有终止方法都返回 Promise。
 * 2. `.modify(fn)` 的回调**只能原地改**（不能有返回值）——
 *    这与 Dexie 的限制一致，也是本项目 GOTCHAS 里记着的约定。
 */

import {
  buildDdl, buildMetaDdl, encodeIndexValue, qi, TABLE_NAMES, TABLE_SCHEMAS,
  toRow, type TableSchema,
} from './sql-schema';

/** SQL 执行器。tauri-plugin-sql 的 Database 天然满足这个形状。 */
export interface SqlDriver {
  execute(sql: string, args?: unknown[]): Promise<{ rowsAffected?: number; lastInsertId?: number }>;
  select<T = Record<string, unknown>>(sql: string, args?: unknown[]): Promise<T[]>;
  close?(): Promise<void>;
}

export type CollectionTerminal = 'toArray' | 'modify' | 'delete' | 'count' | 'first' | 'primaryKeys' | 'sortBy';

/**
 * 链式查询对象：终止方法之前不碰数据库。
 *
 * 字段写成显式声明而不是构造函数参数属性：项目开了 `erasableSyntaxOnly`，
 * 参数属性（`private readonly x`）在那种模式下不被允许（它依赖 emit 阶段改写 class）。
 */
class Query {
  private readonly table: TableSchema;
  private readonly driver: SqlDriver;
  private readonly clauses: { field: string; value: unknown }[];
  private readonly reversed: boolean;
  private readonly predicate: ((row: Record<string, unknown>) => boolean) | null;

  constructor(
    table: TableSchema,
    driver: SqlDriver,
    clauses: { field: string; value: unknown }[] = [],
    reversed = false,
    predicate: ((row: Record<string, unknown>) => boolean) | null = null,
  ) {
    this.table = table;
    this.driver = driver;
    this.clauses = clauses;
    this.reversed = reversed;
    this.predicate = predicate;
  }

  where(field: string): { equals: (v: unknown) => Query } {
    // 复合索引用 '[a+b]'，拆成两条条件
    if (field.startsWith('[') && field.endsWith(']')) {
      const fields = field.slice(1, -1).split('+').map((s) => s.trim());
      const self: Query = this;
      return {
        equals(value: unknown) {
          const arr = Array.isArray(value) ? value : [value];
          let q: Query = self;
          fields.forEach((f, i) => {
            q = q.clone([...q.clauses, { field: f, value: arr[i] }]);
          });
          return q;
        },
      };
    }
    /*
      字段必须是声明的索引之一。

      为什么不"查不到就返回空"：非索引字段在 SQL 里没有对应列，
      静默返回 [] 会让调用方看到"这个项目一条数据都没有" ——
      看起来像数据丢了，实际是查询写错了字段名。
      Dexie 在同样情况下也是直接抛错，这里保持一致，早失败早发现。
    */
    if (!this.isIndexed(field)) {
      throw new Error(
        '未索引的字段无法用于 where()：' + this.table.name + '.' + field +
          '（可用：' + this.availableIndexes().join(', ') + '）',
      );
    }
    const self: Query = this;
    return { equals: (value: unknown) => self.clone([...self.clauses, { field, value }]) };
  }

  /** 该字段是否有真实的索引列（主键也算） */
  private isIndexed(field: string): boolean {
    return this.availableIndexes().includes(field);
  }

  private availableIndexes(): string[] {
    return [
      this.table.primaryKey,
      ...this.table.indexes,
      ...this.table.compounds.map((c) => c.key),
    ];
  }

  /**
   * JS 侧二次过滤（对应 Dexie 的 `.filter(fn)`）。
   *
   * 与已有 predicate **串联**而不是替换：调用方可能链两次 filter，
   * 丢掉前一个就等于静默放宽了条件。
   */
  filter(fn: (row: Record<string, unknown>) => boolean): Query {
    const prev = this.predicate;
    const combined = prev ? (row: Record<string, unknown>) => prev(row) && fn(row) : fn;
    return this.clone(this.clauses, combined);
  }

  reverse(): Query {
    return this.clone(this.clauses, this.predicate, !this.reversed);
  }

  private clone(
    clauses: { field: string; value: unknown }[],
    predicate: ((row: Record<string, unknown>) => boolean) | null = this.predicate,
    reversed = this.reversed,
  ): Query {
    return new Query(this.table, this.driver, clauses, reversed, predicate);
  }

  /** 生成 WHERE 子句与参数 */
  private whereSql(): { sql: string; args: unknown[] } {
    if (!this.clauses.length) return { sql: '', args: [] };
    const parts = this.clauses.map((c) => qi(c.field) + ' = ?');
    return { sql: ' WHERE ' + parts.join(' AND '), args: this.clauses.map((c) => encodeIndexValue(c.value)) };
  }

  private async rows(): Promise<Record<string, unknown>[]> {
    const { sql: w, args } = this.whereSql();
    const order = this.reversed ? ' ORDER BY rowid DESC' : '';
    const raw = await this.driver.select<Record<string, unknown>>(
      'SELECT data FROM ' + qi(this.table.name) + w + order,
      args,
    );
    let list = raw.map((r) => JSON.parse(String(r.data)) as Record<string, unknown>);
    if (this.predicate) list = list.filter((r) => this.predicate!(r));
    return list;
  }

  async toArray(): Promise<Record<string, unknown>[]> {
    return this.rows();
  }

  async count(): Promise<number> {
    const { sql, args } = this.whereSql();
    const rows = await this.driver.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM ' + qi(this.table.name) + sql,
      args,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * 第一条。
   *
   * 不带显式排序时按行的自然顺序取第一条（Dexie 的 first() 也是这个语义）；
   * `reverse()` 之后自然顺序已反转，所以"第一条"就是最后一条。
   * 需要按字段排序请用 `sortBy(field)`。
   */
  async first(): Promise<Record<string, unknown> | undefined> {
    const list = await this.rows();
    return list[0];
  }

  async primaryKeys(): Promise<string[]> {
    const list = await this.rows();
    return list.map((r) => String(r[this.table.primaryKey]));
  }

  /** sortBy 语义：按字段升序排（reverse 后则降序） */
  async sortBy(field: string): Promise<Record<string, unknown>[]> {
    const list = await this.rows();
    const dir = this.reversed ? -1 : 1;
    return list.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      return (av as never) > (bv as never) ? dir : -dir;
    });
  }

  async delete(): Promise<void> {
    const { sql, args } = this.whereSql();
    await this.driver.execute('DELETE FROM ' + qi(this.table.name) + sql, args);
  }

  /**
   * 原地修改。回调**不能有返回值**（与 Dexie 一致，副作用写在参数对象上）。
   *
   * ## 一个差点漏掉的严重 bug
   *
   * 第一版把 `data` 列从 INSERT 里过滤掉了（当时的想法是"data 没变，不用重写"）。
   * 但 **data 才是真正的数据源** —— 索引列只是给它做检索用的副本。
   * 于是 modify 的改动在索引列上生效、在 data 里却原样不动：
   * 用索引查得到"已改过"的行，读出来的对象还是旧值。
   * 症状会是"改了没反应，但偶尔又像是改了"，极难查。
   *
   * 这个 bug 类型检查完全看不出来（整条路径被 cast 成 Dexie 了），
   * 是 `verify-sqlite-adapter` 的 put→modify→get 往返断言抓住的。
   */
  async modify(fn: (row: Record<string, unknown>) => void): Promise<number> {
    const list = await this.rows();
    for (const row of list) fn(row);
    if (!list.length) return 0;
    const pk = this.table.primaryKey;
    // 逐行 UPSERT：主键相同即覆盖，data 与全部索引列一起更新
    for (const row of list) {
      const shaped = toRow(this.table, row);
      const keys = Object.keys(shaped);
      const placeholders = keys.map(() => '?').join(', ');
      const sets = keys.filter((k) => k !== pk).map((k) => qi(k) + ' = excluded.' + qi(k));
      const onConflict = sets.length
        ? ' ON CONFLICT(' + qi(pk) + ') DO UPDATE SET ' + sets.join(', ')
        : ' ON CONFLICT(' + qi(pk) + ') DO NOTHING';
      await this.driver.execute(
        'INSERT INTO ' + qi(this.table.name) + ' (' + keys.map(qi).join(', ') + ') VALUES (' + placeholders + ')' + onConflict,
        keys.map((k) => shaped[k]),
      );
    }
    return list.length;
  }
}

/** 表对象：方法名与 Dexie Table 对齐 */
class Table {
  readonly name: string;
  private readonly driver: SqlDriver;
  private readonly schema: TableSchema;

  constructor(name: string, driver: SqlDriver, schema: TableSchema) {
    this.name = name;
    this.driver = driver;
    this.schema = schema;
  }

  where(field: string): { equals: (v: unknown) => Query } {
    return new Query(this.schema, this.driver).where(field);
  }

  async get(key: unknown): Promise<Record<string, unknown> | undefined> {
    const rows = await this.driver.select<{ data: string }>(
      'SELECT data FROM ' + qi(this.name) + ' WHERE ' + qi(this.schema.primaryKey) + ' = ? LIMIT 1',
      [String(key)],
    );
    return rows[0] ? (JSON.parse(rows[0].data) as Record<string, unknown>) : undefined;
  }

  async put(row: Record<string, unknown>): Promise<unknown> {
    const shaped = toRow(this.schema, row);
    const keys = Object.keys(shaped);
    const placeholders = keys.map(() => '?').join(', ');
    const pk = this.schema.primaryKey;
    const sets = keys.filter((k) => k !== pk).map((k) => qi(k) + ' = excluded.' + qi(k));
    await this.driver.execute(
      'INSERT INTO ' + qi(this.name) + ' (' + keys.map(qi).join(', ') + ') VALUES (' + placeholders + ')' +
        ' ON CONFLICT(' + qi(pk) + ') DO UPDATE SET ' + sets.join(', '),
      keys.map((k) => shaped[k]),
    );
    return pk in row ? row[pk] : shaped[pk];
  }

  async add(row: Record<string, unknown>): Promise<unknown> {
    // Dexie 的 add 不覆盖已存在的行；主键冲突必须报错而不是静默改写
    const existing = await this.get(row[this.schema.primaryKey]);
    if (existing) throw new Error('Key already exists: ' + row[this.schema.primaryKey]);
    return this.put(row);
  }

  async bulkPut(rows: Record<string, unknown>[]): Promise<unknown> {
    for (const r of rows) await this.put(r);
    return rows.length;
  }

  async delete(key: unknown): Promise<void> {
    await this.driver.execute('DELETE FROM ' + qi(this.name) + ' WHERE ' + qi(this.schema.primaryKey) + ' = ?', [String(key)]);
  }

  async clear(): Promise<void> {
    await this.driver.execute('DELETE FROM ' + qi(this.name));
  }

  async count(): Promise<number> {
    const rows = await this.driver.select<{ n: number }>('SELECT COUNT(*) AS n FROM ' + qi(this.name));
    return Number(rows[0]?.n ?? 0);
  }

  async toArray(): Promise<Record<string, unknown>[]> {
    return new Query(this.schema, this.driver).toArray();
  }
}

/**
 * SQLite 版数据库对象。
 *
 * `transaction` 用显式 BEGIN/COMMIT。注意 Dexie 的 transaction 回调里可以
 * 同步改状态再异步写库 —— 这里的实现同样是"回调整体在一个事务里"。
 * 嵌套事务用 SAVEPOINT，否则内层 COMMIT 会把外层的也提交掉。
 */
export class SqliteDatabase {
  readonly name = 'huajiao-sqlite';
  readonly verno: number;
  readonly tables: Table[];
  private readonly driver: SqlDriver;
  private readonly map = new Map<string, Table>();
  private depth = 0;

  constructor(driver: SqlDriver, version: number) {
    this.driver = driver;
    this.verno = version;
    this.tables = TABLE_SCHEMAS.map((s) => {
      const t = new Table(s.name, driver, s);
      this.map.set(s.name, t);
      return t;
    });
  }

  /** 建表。连接建立后调用一次即可（DDL 全是 IF NOT EXISTS）。 */
  async init(): Promise<void> {
    for (const ddl of buildMetaDdl()) await this.driver.execute(ddl);
    for (const ddl of buildDdl()) await this.driver.execute(ddl);
  }

  /** 像 Dexie 那样按属性名取表：db.chapters */
  get chapters(): Table { return this.map.get('chapters')!; }

  table(name: string): Table {
    const t = this.map.get(name);
    if (!t) throw new Error('未知的数据表：' + name);
    return t;
  }

  async open(): Promise<this> {
    await this.init();
    return this;
  }

  /** 清空全部表（对应 Dexie 的 db.delete()，用于 wipeDatabase） */
  async delete(): Promise<void> {
    for (const name of TABLE_NAMES) {
      await this.driver.execute('DELETE FROM ' + qi(name));
    }
  }

  async close(): Promise<void> {
    await this.driver.close?.();
  }

  async transaction<T>(_mode: string, _tables: unknown, cb: () => Promise<T>): Promise<T> {
    const nested = this.depth > 0;
    const name = 'sp_' + this.depth;
    await this.driver.execute(nested ? 'SAVEPOINT ' + name : 'BEGIN');
    this.depth += 1;
    try {
      const out = await cb();
      this.depth -= 1;
      await this.driver.execute(nested ? 'RELEASE ' + name : 'COMMIT');
      return out;
    } catch (e) {
      this.depth -= 1;
      await this.driver.execute(nested ? 'ROLLBACK TO ' + name : 'ROLLBACK');
      // 释放 savepoint，否则后续事务仍带着已回滚的帧
      if (nested) await this.driver.execute('RELEASE ' + name);
      throw e;
    }
  }
}

/** 供测试注入的内存实现：真的按 SQL 语义跑，只是存在 Map 里 */
export function createFakeDriver(): SqlDriver & { rows: Map<string, Map<string, Record<string, unknown>>>; log: string[] } {
  const rows = new Map<string, Map<string, Record<string, unknown>>>();
  for (const n of TABLE_NAMES) rows.set(n, new Map());
  const log: string[] = [];

  const parseSimple = (sql: string): { table: string; where: Map<string, string>; op: string } => {
    const op = /^\s*(SELECT|DELETE|INSERT)/i.exec(sql)?.[1].toUpperCase() ?? 'SELECT';
    const table = /FROM\s+"?(\w+)"?|INTO\s+"?(\w+)"?/i.exec(sql);
    const name = (table?.[1] ?? table?.[2] ?? '').replace(/"/g, '');
    const where = new Map<string, string>();
    const m = /WHERE\s+(.+?)(?:\s+ORDER BY|\s+LIMIT|$)/is.exec(sql);
    if (m) {
      for (const part of m[1].split(/\s+AND\s+/i)) {
        const kv = /"?(\w+)"?\s*=\s*\?/.exec(part);
        if (!kv) continue;
        where.set(kv[1], '?' + where.size);
      }
    }
    return { table: name, where, op };
  };

  const resolve = (t: string, where: Map<string, string>, args: unknown[]): Record<string, unknown>[] => {
    const store = rows.get(t) ?? new Map();
    let list = [...store.values()];
    for (const [col, ph] of where) {
      const want = args[Number(ph.slice(1))];
      list = list.filter((r) => String(r[col] ?? '') === String(want ?? ''));
    }
    return list;
  };

  return {
    rows,
    log,
    async execute(sql: string, args: unknown[] = []) {
      log.push(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|CREATE)/i.test(sql.trim())) return { rowsAffected: 0 };
      if (/^DELETE\s+FROM/i.test(sql.trim())) {
        const { table, where } = parseSimple(sql);
        const list = resolve(table, where, args);
        const store = rows.get(table)!;
        for (const r of list) store.delete(String(r.__pk ?? ''));
        return { rowsAffected: list.length };
      }
      if (/^INSERT\s+INTO/i.test(sql.trim())) {
        const { table } = parseSimple(sql);
        const store = rows.get(table)!;
        const cols = [...(/\(([^)]*)\)/.exec(sql)?.[1] ?? '').matchAll(/"(\w+)"/g)].map((x) => x[1]);
        /*
          主键列从 `ON CONFLICT("pk")` 里读，**不要假设它是第一列**。
          参数顺序跟着列顺序走，而列顺序由 toRow 的对象键序决定 ——
          曾经假设过 vals[0] 是主键，结果 toRow 把 data 排在前面，
          每次 put 都换一个"主键"（那串 JSON），于是"覆盖"变成了"新增"，
          两次 put 之后表里躺了两行，测试才把它抓出来。
        */
        const pkCol = /ON CONFLICT\("(\w+)"\)/i.exec(sql)?.[1] ?? cols[0];
        const pkIdx = cols.indexOf(pkCol);
        const row: Record<string, unknown> = {};
        cols.forEach((c, i) => (row[c] = args[i]));
        const key = String(args[pkIdx < 0 ? 0 : pkIdx] ?? '');
        row.__pk = key;
        store.set(key, row);
        return { rowsAffected: 1 };
      }
      return { rowsAffected: 0 };
    },
    async select<T>(sql: string, args: unknown[] = []): Promise<T[]> {
      log.push(sql);
      if (/COUNT\(\*\)/i.test(sql)) {
        const { table, where } = parseSimple(sql);
        return [{ n: resolve(table, where, args).length }] as T[];
      }
      const { table, where } = parseSimple(sql);
      const list = resolve(table, where, args);
      const reversed = /ORDER BY rowid DESC/i.test(sql);
      const ordered = reversed ? list.reverse() : list;
      return ordered.map((r) => ({ data: r.data })) as T[];
    },
  };
}
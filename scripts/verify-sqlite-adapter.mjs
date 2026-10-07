/**
 * 回归：SQLite 适配层（`src/db/adapter/*`）。
 *
 * ## 为什么必须有这一条
 *
 * `database.ts` 把 SQLite 后端 cast 成 Dexie 的类型，好让 23 个直接用 `db.*`
 * 的文件一行不改。代价是**类型系统不再校验这条路径** ——
 * 适配层少实现一个方法，`tsc` 一句话都不会说，只有真在桌面端点到那个功能才会炸。
 *
 * 类型能骗过人，断言不能。所以这里用**假 driver**（真的按 SQL 语义跑，只是存在 Map 里）
 * 把适配层的每个方法都过一遍。
 *
 * ## 为什么是假 driver 而不是真 SQLite
 *
 * 项目里的回归全部离线可复跑（见 scripts/README）。真 SQLite 要么依赖
 * Tauri（跑不起来），要么依赖 node 的原生模块（各平台编译不一致）。
 * 假 driver 验证的是**适配层自己生成的 SQL 与数据往返**：
 *   - 建表/索引 DDL 是否覆盖了每张表的每个索引
 *   - put→get 往返后对象是否**完全相等**（嵌套结构不能丢）
 *   - where(f).equals(v) 的过滤、复合索引拆解、modify 的原地改、排序方向
 * 这些才是会写错的地方。SQL 引擎本身不用我们测。
 */
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const load = (p) => vite.ssrLoadModule('/' + p);

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  \u2713 ' + name);
  } else {
    fail += 1;
    console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : ''));
  }
};

const sqlSchema = await load('src/db/adapter/sql-schema.ts');
const sqlite = await load('src/db/adapter/sqlite.ts');
const schema = await load('src/db/schema.ts');

// ==================== 一、从 DB_STORES 推表结构 ====================
console.log('');
console.log('【表结构推导】');

const dexieNames = Object.keys(schema.DB_STORES).sort();
const adapterNames = [...sqlSchema.TABLE_NAMES].sort();
check(
  '每一张 Dexie 表都有对应的 SQL 表（不多不少）',
  JSON.stringify(dexieNames) === JSON.stringify(adapterNames),
  'Dexie ' + dexieNames.length + ' vs SQL ' + adapterNames.length,
);

{
  // 复合索引必须被解析出来 —— 漏一个就有一处查询退化成全表扫描（或直接查错）
  const s = sqlSchema.tableSchema('chapters');
  check('复合索引 [projectId+order] 被解析',
    s.compounds.some((c) => c.fields.join('+') === 'projectId+order'), JSON.stringify(s.compounds));
  check('主键取自索引串第一位', s.primaryKey === 'id', s.primaryKey);
  check('单列索引被解析', s.indexes.includes('projectId') && s.indexes.includes('arcId'),
    JSON.stringify(s.indexes));
}
{
  // 主键不是 id 的表（Dexie 用表外键当主键，容易漏）
  const s = sqlSchema.tableSchema('chapterContents');
  check('chapterContents 主键是 chapterId 而不是 id', s.primaryKey === 'chapterId', s.primaryKey);
  const r = sqlSchema.tableSchema('routing');
  check('routing 主键是 kind', r.primaryKey === 'kind', r.primaryKey);
}

// 全量自检：每张表的主键必须真的是索引串的第一项
{
  const bad = sqlSchema.TABLE_SCHEMAS.filter((t) => {
    const spec = schema.DB_STORES[t.name];
    const first = spec.split(',')[0].trim();
    return first !== t.primaryKey;
  });
  check('全部表的主键解析正确', bad.length === 0, JSON.stringify(bad.map((b) => b.name)));
}

console.log('【建表 DDL】');
{
  const ddl = sqlSchema.buildDdl();
  const createTables = ddl.filter((d) => d.startsWith('CREATE TABLE'));
  check('每张表都有 CREATE TABLE', createTables.length === sqlSchema.TABLE_SCHEMAS.length,
    createTables.length + ' vs ' + sqlSchema.TABLE_SCHEMAS.length);
  check('DDL 全部幂等（IF NOT EXISTS）', ddl.every((d) => d.includes('IF NOT EXISTS')),
    ddl.find((d) => !d.includes('IF NOT EXISTS')));
  // 每张表的每个声明索引都要有对应 CREATE INDEX，否则查询性能静默退化
  const missing = [];
  for (const t of sqlSchema.TABLE_SCHEMAS) {
    for (const idx of t.indexes) {
      if (idx === t.primaryKey) continue;
      const want = 'ix_' + t.name + '_' + idx;
      if (!ddl.some((d) => d.includes('"' + want + '"'))) missing.push(want);
    }
    for (const c of t.compounds) {
      const want = 'ix_' + t.name + '_' + c.fields.join('_');
      if (!ddl.some((d) => d.includes('"' + want + '"'))) missing.push(want);
    }
  }
  check('每个声明的索引都有 CREATE INDEX', missing.length === 0, JSON.stringify(missing.slice(0, 5)));
  check('主键列是 TEXT PRIMARY KEY', ddl[0].includes('TEXT PRIMARY KEY'), ddl[0].slice(0, 80));
  check('有 data 列承载整行 JSON', ddl[0].includes('"data" TEXT NOT NULL'));
}

console.log('【索引值编码】');
{
  check('null / undefined → NULL',
    sqlSchema.encodeIndexValue(null) === null && sqlSchema.encodeIndexValue(undefined) === null);
  // boolean 必须编码成 '1'/'0'：存成 'true' 的话 WHERE resolved = 0 匹配不到
  check('boolean → 1 / 0', sqlSchema.encodeIndexValue(true) === '1' && sqlSchema.encodeIndexValue(false) === '0');
  check('number → 十进制字符串', sqlSchema.encodeIndexValue(3.5) === '3.5');
  check('string 原样', sqlSchema.encodeIndexValue('abc') === 'abc');
  check('对象/数组 → JSON 文本', sqlSchema.encodeIndexValue(['a']) === '["a"]');
}

// ==================== 二、适配层行为 ====================
console.log('');
console.log('【适配层：基本读写】');

const driver = sqlite.createFakeDriver();
const db = new sqlite.SqliteDatabase(driver, schema.DB_VERSION);
await db.init();

const now = '2026-10-08T00:00:00.000Z';
const chapter = {
  id: 'c1', projectId: 'p1', arcId: 'a1', title: '第一章', summary: '梗概',
  goals: ['目标一', '目标二'], characterIds: ['ch1'],
  beats: [{ id: 'b1', text: '节拍' }], tags: [], order: 0, status: 'drafting',
  wordCount: 1200, tension: 3, createdAt: now, updatedAt: now,
};

await db.table('chapters').put(chapter);
{
  const got = await db.table('chapters').get('c1');
  // 嵌套结构必须原样回来 —— 拆列存最容易在这类字段上丢东西
  check('put → get 往返后对象完全相等',
    JSON.stringify(got) === JSON.stringify(chapter),
    JSON.stringify(got));
  check('嵌套数组与对象都保留', Array.isArray(got.goals) && got.goals.length === 2 &&
    got.beats[0].text === '节拍');
}
{
  // 更新：同主键再 put 应覆盖而不是插两行
  await db.table('chapters').put({ ...chapter, title: '第一章（改）' });
  const all = await db.table('chapters').toArray();
  check('同主键 put 是覆盖而非新增', all.length === 1, String(all.length));
  const got = await db.table('chapters').get('c1');
  check('覆盖后字段已更新', got.title === '第一章（改）', got.title);
  // 索引列也要跟着更新。注意用 status —— title 在 chapters 上**不是**索引，
  // 拿它做 where 会被适配层显式拒绝（第一版我把测试写成按 title 查，
  // 失败原因看起来像"覆盖没生效"，其实是测试选错了字段）。
  await db.table('chapters').put({ ...chapter, title: '第一章（改）', status: 'done' });
  check('覆盖后索引列也更新（按新值可查到）',
    (await db.table('chapters').where('status').equals('done').toArray()).length === 1);
  check('旧的索引值不再命中',
    (await db.table('chapters').where('status').equals('drafting').toArray()).length === 0);
}
{
  // 非索引字段必须明确报错，而不是静默返回空
  // （静默返回空看起来就像"数据丢了"，最难查）
  let msg = '';
  try {
    await db.table('chapters').where('summary').equals('梗概').toArray();
  } catch (e) {
    msg = String(e.message ?? e);
  }
  check('未索引字段 where 会明确报错', msg.includes('未索引'), msg.slice(0, 80));
  check('报错里列出可用索引（便于修）', msg.includes('projectId'), msg.slice(0, 120));
}
{
  check('get 不存在的主键返回 undefined', (await db.table('chapters').get('nope')) === undefined);
  await db.table('chapters').delete('c1');
  check('delete 后查不到', (await db.table('chapters').get('c1')) === undefined);
  await db.table('chapters').clear();
  check('clear 清空表', (await db.table('chapters').count()) === 0);
}

console.log('【适配层：add 不覆盖】');
{
  await db.table('chapters').clear();
  await db.table('chapters').put(chapter);
  let threw = false;
  try {
    await db.table('chapters').add({ ...chapter, title: '不该覆盖' });
  } catch {
    threw = true;
  }
  // Dexie 的 add 在键已存在时必须报错，否则"新建"会悄悄改写旧数据
  check('add 遇到已存在主键会报错', threw);
  const got = await db.table('chapters').get('c1');
  check('add 失败后原数据未被改动', got.title === '第一章', got.title);
}

console.log('【适配层：查询】');
{
  await db.table('chapters').clear();
  for (let i = 0; i < 5; i++) {
    await db.table('chapters').put({ ...chapter, id: 'c' + i, projectId: i < 3 ? 'p1' : 'p2', order: i });
  }
  const p1 = await db.table('chapters').where('projectId').equals('p1').toArray();
  check('where().equals() 过滤正确', p1.length === 3, String(p1.length));
  check('where().equals() 结果内容正确', p1.every((c) => c.projectId === 'p1'));

  const n = await db.table('chapters').where('projectId').equals('p1').count();
  check('count() 与 toArray().length 一致', n === 3, String(n));

  // 复合索引：'[a+b]' 拆成两条 AND 条件
  const comp = await db.table('chapters').where('[projectId+order]').equals(['p1', 1]).toArray();
  check('复合索引查询命中唯一行', comp.length === 1 && comp[0].order === 1,
    JSON.stringify(comp.map((c) => c.order)));

  const keys = await db.table('chapters').where('projectId').equals('p2').primaryKeys();
  check('primaryKeys() 返回主键数组', JSON.stringify(keys.sort()) === JSON.stringify(['c3', 'c4']),
    JSON.stringify(keys));

  // reverse + sortBy：SnapshotPanel 用的就是这条链
  const desc = await db.table('chapters').where('projectId').equals('p1').reverse().sortBy('order');
  check('reverse().sortBy() 为降序', JSON.stringify(desc.map((c) => c.order)) === JSON.stringify([2, 1, 0]),
    JSON.stringify(desc.map((c) => c.order)));

  // filter：JS 侧二次过滤
  const filtered = await db.table('chapters').where('projectId').equals('p1').filter((r) => r.order > 1).toArray();
  check('filter() 在 where 之上再筛', filtered.length === 1 && filtered[0].order === 2,
    JSON.stringify(filtered.map((c) => c.order)));

  const first = await db.table('chapters').where('[projectId+kind]').equals(['p1', 'x']).first();
  check('无匹配时 first() 返回 undefined', first === undefined);
}

console.log('【适配层：modify 原地改】');
{
  await db.table('chapters').clear();
  await db.table('chapters').put({ ...chapter, id: 'm1', projectId: 'pm', wordCount: 1 });
  const touched = await db.table('chapters').where('projectId').equals('pm').modify((row) => {
    // 与 Dexie 一致：回调不能有返回值，副作用写在参数上
    row.wordCount = 99;
    row.title = '改过';
  });
  check('modify 返回受影响行数', touched === 1, String(touched));
  const got = await db.table('chapters').get('m1');
  check('modify 的改动已持久化', got.wordCount === 99 && got.title === '改过', JSON.stringify(got));
  check('modify 未破坏其他字段', got.projectId === 'pm' && got.createdAt === now);
}

console.log('【适配层：bulkPut 与 db.tables】');
{
  await db.table('chapters').clear();
  await db.table('chapters').bulkPut([
    { ...chapter, id: 'b1', order: 1 },
    { ...chapter, id: 'b2', order: 2 },
  ]);
  check('bulkPut 批量写入', (await db.table('chapters').count()) === 2);
  // exporters.ts 会遍历 db.tables，这里必须是真的数组（Proxy 方案就是死在这）
  check('db.tables 是数组', Array.isArray(db.tables));
  check('db.tables 覆盖全部表', db.tables.length === sqlSchema.TABLE_SCHEMAS.length,
    String(db.tables.length));
  check('db.tables 项有 name 字段（exporters 靠它建映射）', typeof db.tables[0].name === 'string');
  check('db.tables 项可 count（备份统计要遍历）',
    typeof (await db.tables[0].count()) === 'number');
}

console.log('【适配层：事务】');
{
  await db.table('chapters').clear();
  await db.transaction('rw', [db.table('chapters')], async () => {
    await db.table('chapters').put({ ...chapter, id: 't1' });
  });
  check('事务提交后数据可见', (await db.table('chapters').count()) === 1);

  let threw = false;
  try {
    await db.transaction('rw', [db.table('chapters')], async () => {
      await db.table('chapters').put({ ...chapter, id: 't2' });
      throw new Error('故意失败');
    });
  } catch {
    threw = true;
  }
  check('事务失败会向上抛错', threw);
  check('SQL 里出现了 BEGIN / COMMIT / ROLLBACK',
    driver.log.some((s) => /^BEGIN$/i.test(s.trim())) &&
    driver.log.some((s) => /^COMMIT$/i.test(s.trim())) &&
    driver.log.some((s) => /^ROLLBACK/i.test(s.trim())));

  // 嵌套事务必须用 SAVEPOINT，否则内层 COMMIT 会连外层一起提交
  driver.log.length = 0;
  await db.transaction('rw', [db.table('chapters')], async () => {
    await db.transaction('rw', [db.table('chapters')], async () => {
      await db.table('chapters').put({ ...chapter, id: 't3' });
    });
  });
  check('嵌套事务用 SAVEPOINT 而不是再次 BEGIN',
    driver.log.some((s) => /^SAVEPOINT/i.test(s.trim())) &&
    driver.log.filter((s) => /^BEGIN$/i.test(s.trim())).length === 1,
    JSON.stringify(driver.log.filter((s) => /BEGIN|SAVEPOINT|RELEASE/i.test(s))));
}

console.log('【适配层：db.delete 清空全部表】');
{
  await db.table('chapters').put({ ...chapter, id: 'd1' });
  await db.delete();
  check('db.delete() 清空所有表', (await db.table('chapters').count()) === 0);
  const nonEmpty = [];
  for (const t of db.tables) {
    if ((await t.count()) !== 0) nonEmpty.push(t.name);
  }
  check('清空后没有残留数据', nonEmpty.length === 0, JSON.stringify(nonEmpty));
  // wipeDatabase 会紧接着 open()，DDL 必须能重复执行
  await db.open();
  check('delete 之后能重新 open（DDL 幂等）', true);
}

console.log('');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
await vite.close();
process.exit(fail === 0 ? 0 : 1);
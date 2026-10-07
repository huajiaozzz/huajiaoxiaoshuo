import Dexie from 'dexie';
import type { AppState } from '@/core';
import { DB_NAME, DB_STORES, DB_VERSION, type HuaJiaoDB } from './schema';
import { V1_STORES, V2_STORES, V3_STORES, V4_STORES, V5_STORES, V6_STORES, V7_STORES } from './v1-stores';
import { SqliteDatabase } from './adapter/sqlite';
import { createLazyDriver, isDesktop, openTauriSqlite } from './adapter/index';

/**
 * 用声明合并把 HuaJiaoDB 的表定义挂到 Dexie 实例上：
 * 这样 db.chapters.where(...) 有完整类型，同时保留 Dexie 的运行时能力。
 */
class Database extends Dexie {
  constructor() {
    super(DB_NAME);
    // v1：初始结构
    // v2：新增 comments / reviewSuggestions（审稿协作）
    // v3：新增 memory（写作记忆）
    // v4：新增 memoryUsage（记忆效果追踪：哪次生成用了哪些记忆）
    // v5：新增 blueprints（拆书蓝图：技法层 + 内容层 + 参考原文）
    // v6：新增 licenses（授权状态：设备线 / 域名线各一条）
    // v7：新增 knowledgePages（知识页：按主题自动组装的 condensed 页面）
    // v8：新增 userTemplates（用户模板库：整本拆书自动入库）
    // 每个版本都必须声明"当时的完整结构"，不能直接复用最新的一份，
    // 否则 Dexie 做版本 diff 时会算错增删，破坏老库升级。
    this.version(1).stores(V1_STORES as unknown as Record<string, string>);
    this.version(2).stores(V2_STORES as unknown as Record<string, string>);
    this.version(3).stores(V3_STORES as unknown as Record<string, string>);
    this.version(4).stores(V4_STORES as unknown as Record<string, string>);
    this.version(5).stores(V5_STORES as unknown as Record<string, string>);
    this.version(6).stores(V6_STORES as unknown as Record<string, string>);
    this.version(7).stores(V7_STORES as unknown as Record<string, string>);
    this.version(DB_VERSION).stores(DB_STORES as unknown as Record<string, string>);
  }
}

interface Database extends HuaJiaoDB {}

const dexieDb = new Database() as Database & HuaJiaoDB;

/**
 * 桌面端（SQLite）与浏览器端（IndexedDB）的分流点 —— **全项目唯一的一处**。
 *
 * ## 为什么类型上要 cast
 *
 * `db` 的类型被写成 Dexie，SQLite 实现在运行时提供**同一套方法形状**。
 * 这样 23 个直接用 `db.*` 的文件（`src/ai` 11 个、`src/features` 4 个等）
 * 一行都不用改，也不用为 Web / 桌面维护两套调用写法。
 *
 * 代价是这个 cast 让**类型系统不再校验桌面端路径** —— 类型能骗过人，断言不能。
 * 所以 `src/db/adapter/sqlite.ts` 的每个方法都在 `scripts/verify-sqlite-adapter.mjs`
 * 里有对应用例；改动那个文件时，回归会立刻指出漏了哪个方法。
 *
 * ## 为什么能在模块加载时同步决定后端
 *
 * 关键：**只有 Tauri 运行时那一个 import 是异步的**。
 * `SqliteDatabase` 与 driver 接口都是纯 TS，可以静态 import；
 * 而 `SqliteDatabase` 的**构造函数不碰数据库**（只按表结构建出表对象数组），
 * 所以能同步造出来 —— 于是 `db` 一开始就是对的后端，不需要任何"加载后再替换"。
 *
 * ## 三条走不通的写法（都试过，写在这里免得后人重走）
 *
 * 1. **Proxy 懒加载**：`exporters.ts` 会遍历 `db.tables`（备份/恢复要清空所有表），
 *    代理交出的是函数而不是数组，直接崩；而且 `db.chapters` 是**属性**不是方法，
 *    代理返回 Promise 会让 `db.chapters.where(...)` 变成对 Promise 取属性。
 * 2. **加载后 `Object.assign(db, backend)`**：表访问器在**原型**上，
 *    `Object.assign` 只搬自有属性，搬不过去。
 * 3. **`bootstrapDatabase()` 里给 `db` 重新赋值**：`export const` 不可重新赋值，
 *    改成 `let` 又要赌所有 import 站点都读实时绑定 —— 赌注太大，不值得。
 */
const sqliteDb: Database | null = isDesktop() ? buildSqliteDb() : null;

function buildSqliteDb(): Database & HuaJiaoDB {
  /*
    连接 → 建表，串成一条链之后再交给懒 driver。
    这样**建表 DDL 一定排在第一个业务查询之前**；
    若写成 `void db.init()` 让它自己跑，建表与查询就是两条独立链，谁先到不确定。
  */
  const ready = openTauriSqlite().then(async (driver) => {
    await new SqliteDatabase(driver, DB_VERSION).init();
    return driver;
  });
  const backend = new SqliteDatabase(createLazyDriver(ready), DB_VERSION);
  return backend as unknown as Database & HuaJiaoDB;
}

export const db: Database & HuaJiaoDB = (sqliteDb ?? dexieDb) as Database & HuaJiaoDB;

/**
 * 等存储就绪。
 *
 * 浏览器端立刻返回（Dexie 自己处理打开）；
 * 桌面端等连接 + 建表完成 —— `main.tsx` 在渲染前 await 它，
 * 让"建表失败"以启动错误的形式暴露，而不是变成第一个查询的神秘失败
 * （懒 driver 会排队，所以不 await 也能用，只是错误被推迟到某个随机查询上）。
 */
export async function databaseReady(): Promise<void> {
  if (!sqliteDb) return;
  // 借一次最便宜的读操作把懒 driver 的 ready 链走完
  await sqliteDb.appState.count();
}

export function tables(): HuaJiaoDB {
  return db;
}

/** 首次使用写入默认应用状态 */
export async function ensureAppState(): Promise<AppState> {
  const existing = await db.appState.get('singleton');
  if (existing) return existing;
  const now = new Date().toISOString();
  const fresh: AppState = {
    id: 'singleton',
    recentProjectIds: [],
    onboardingDone: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.appState.put(fresh);
  return fresh;
}

/** 全库统计：设置页 / 数据管理页展示用 */
export async function databaseStats(): Promise<{
  name: string;
  verno: number;
  stores: { name: string; count: number }[];
  totalRecords: number;
  estimatedBytes: number;
}> {
  const counts = await Promise.all(db.tables.map((t) => t.count().catch(() => 0)));
  let estimatedBytes = 0;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      estimatedBytes = est.usage ?? 0;
    }
  } catch {
    estimatedBytes = 0;
  }
  return {
    name: db.name,
    verno: db.verno,
    stores: db.tables.map((t, i) => ({ name: t.name, count: counts[i] })),
    totalRecords: counts.reduce((a, b) => a + b, 0),
    estimatedBytes,
  };
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/** 清空整个数据库（危险操作，UI 需二次确认） */
export async function wipeDatabase(): Promise<void> {
  await db.delete();
  await db.open();
}

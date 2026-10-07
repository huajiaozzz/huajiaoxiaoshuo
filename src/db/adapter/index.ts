/**
 * 存储后端选择：桌面端走 SQLite，浏览器走 IndexedDB。
 *
 * ## 判定方式
 *
 * 用 Tauri 注入的 `__TAURI_INTERNALS__` 判断。**不用 `@tauri-apps/api` 的 isTauri()**：
 * 那个包在 Web 端也能被打进包里，多一个依赖就多一份体积，
 * 而我们只需要一个布尔判断。
 *
 * ## 为什么必须是"运行时"而不是"构建时"
 *
 * 同一份构建产物要同时在浏览器和桌面端跑（README 明确写了这一点）。
 * 构建时切换会让两条发布流水线分叉，桌面端每次改前端都要重新配环境变量。
 *
 * ## 取连接是个异步问题
 *
 * 打开 SQLite 连接需要 await，而 `db` 是模块级同步常量。
 * 解决办法是**懒连接**：`db` 立刻可用，第一次真正访问表时才 await 连接。
 * 所有表方法本来就已经返回 Promise，所以多一层 await 不影响调用方。
 */

import type { SqlDriver } from './sqlite';

export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>);
}

/**
 * 桌面端的真实 driver：动态 import Tauri 插件。
 *
 * 动态 import 是必须的 —— Web 端构建里根本没有这个依赖，
 * 静态 import 会让打包器报错。
 */
export async function openTauriSqlite(): Promise<SqlDriver> {
  const mod = await import('@tauri-apps/plugin-sql');
  const db = await mod.default.load('sqlite:huajiao.db');
  return {
    execute: async (sql, args) => {
      await db.execute(sql, args as never);
      return {};
    },
    select: (sql, args) => db.select(sql, args as never) as Promise<never[]>,
    close: async () => {
      await db.close();
    },
  };
}

/**
 * 懒 driver：连接就绪前把调用排进队列。
 *
 * ## 为什么需要它
 *
 * 打开 SQLite 连接必须 await，而 `db` 是模块级同步常量，
 * 且调用方（`db.chapters.where(...)`）拿到表之后就立刻开始用。
 * 于是让 driver 先当"占位符"，真正的方法等 ready 之后再转发 ——
 * 这样 `db` 对象可以在模块加载时同步造出来，表数组也是真的数组
 * （`exporters.ts` 会遍历 `db.tables`，代理方案在那里会直接崩）。
 */
export function createLazyDriver(ready: Promise<SqlDriver>): SqlDriver {
  return {
    execute: (sql, args) => ready.then((d) => d.execute(sql, args)),
    select: (sql, args) => ready.then((d) => d.select(sql, args)),
    close: () => ready.then((d) => d.close?.()).then(() => undefined),
  };
}
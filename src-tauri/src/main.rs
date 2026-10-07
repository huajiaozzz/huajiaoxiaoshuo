#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/**
 * 桌面端入口。
 *
 * ## 为什么注册 tauri-plugin-sql
 *
 * 桌面端的数据存储走 SQLite（`src/db/adapter/sqlite.ts`），
 * 前端通过 `@tauri-apps/plugin-sql` 调用它。这个插件是前端能碰到
 * SQLite 的**唯一**通道 —— 不注册的话，前端第一次查库会报
 * "plugin sql not found"，而 Web 端完全正常，很容易误判成前端 bug。
 *
 * ## 关于 migrations
 *
 * 这里**不**用插件的 migration 机制。原因：表结构已经由
 * `src/db/schema.ts` 的 `DB_STORES` 单一来源声明，前端在连接后就地建表
 * （`buildDdl()` 全是 IF NOT EXISTS）。再维护一份 Rust 侧 migration，
 * 就成了两个数据源 —— 加一张表漏改一处，症状是"桌面端某页数据不见了"。
 *
 * 插件的 `preload` 里必须显式给出这个连接，否则前端 `load()` 会被拒绝。
 */
fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                // 连接标识必须与前端 `Database.load('sqlite:huajiao.db')` 完全一致
                .add_migrations("sqlite:huajiao.db", vec![])
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { BrowserRouter } from "react-router-dom";
import { refreshLicenses } from "@/license/status";
import { databaseReady } from "@/db/database";
import App from "./app/App";
import { registerServiceWorker } from "./app/registerSW";
import "./styles/globals.css";

registerServiceWorker();

/*
  存储就绪再挂载。

  浏览器端立刻返回（Dexie 自己处理打开）；**桌面端要等 SQLite 连接 + 建表完成**。
  不等的话，建表失败会变成某个随机查询的神秘报错，而不是一条明确的启动错误。
  这是"启动路径上的异步必须先走完"的一个具体例子。
*/
void databaseReady()
  .catch((e) => {
    console.error("存储初始化失败", e);
  })
  .finally(() => {
    // 启动时核对一次授权（两条线各自判断自己的间隔，不到期就不发请求）
    void refreshLicenses();

    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        {/* reducedMotion="user"：系统开了「减少动态效果」时，motion 系动画自动退化为直接落位
            （globals.css 的 prefers-reduced-motion 只管 CSS 动画，管不到 motion 的 spring） */}
        <MotionConfig reducedMotion="user">
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </MotionConfig>
      </StrictMode>,
    );
  });

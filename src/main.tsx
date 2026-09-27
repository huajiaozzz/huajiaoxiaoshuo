import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { BrowserRouter } from "react-router-dom";
import { refreshLicenses } from "@/license/status";
import App from "./app/App";
import { registerServiceWorker } from "./app/registerSW";
import "./styles/globals.css";

registerServiceWorker();

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

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

// Dynamic --vh helper for older WebKit / WebViews (Safari Fullscreen Guide Section 5)
function updateVh() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
}
updateVh();
window.addEventListener("resize", updateVh);
window.addEventListener("orientationchange", updateVh);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register PWA Service Worker in production
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("PWA Service Worker registration failed:", err);
    });
  });
}

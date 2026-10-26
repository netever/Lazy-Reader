import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { perfMark } from "./api";
import "./styles.css";

async function start() {
  // In a plain browser during development there is no Rust core: use the mock (src/dev).
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    const { installMockBackend } = await import("./dev/mock-backend");
    await installMockBackend();
  }
  perfMark("js_start");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();

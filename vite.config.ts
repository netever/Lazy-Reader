import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // foliate-js is a git submodule in vendor/ (docs/adr/0002-foliate-js.md)
    alias: { "foliate-js": path.resolve(import.meta.dirname, "vendor/foliate-js") },
  },
  build: {
    // WebView2, Android System WebView and WKWebView are all recent enough for ES2022
    target: "es2022",
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },

  // Options for `tauri dev`:
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // 3. do not watch the Rust side
    watch: { ignored: ["**/src-tauri/**"] },
  },
});

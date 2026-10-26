#!/usr/bin/env node
// Evaluate a JavaScript expression inside the app's WebView on a connected Android device or
// emulator, in the main page and in every frame (book sections live in iframes).
// Works with debug builds, where WebView debugging is on.
//
// Usage:  node scripts/webview-eval.mjs "document.title"
//         node scripts/webview-eval.mjs --frames "document.body?.dataset.scriptRan ?? 'no'"
//
// Requires adb in PATH (source scripts/env.sh). Node 22+ (built-in WebSocket and fetch).
import { execFileSync } from "node:child_process";

const PKG = "com.lazyreader.app";
const PORT = 9333;
const args = process.argv.slice(2);
const framesOnly = args[0] === "--frames";
const expression = framesOnly ? args[1] : args[0];
if (!expression) {
  console.error('usage: node scripts/webview-eval.mjs [--frames] "<expression>"');
  process.exit(2);
}

const adb = (...a) => execFileSync("adb", a, { encoding: "utf8" }).trim();
const pid = adb("shell", "pidof", PKG);
if (!pid) throw new Error(`${PKG} is not running`);
adb("forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target: " + JSON.stringify(targets));

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const contexts = [];
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.executionContextCreated") {
    contexts.push(msg.params.context);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Runtime.enable");
await new Promise((r) => setTimeout(r, 500));

const results = [];
for (const ctx of contexts) {
  const isMain = ctx.auxData?.isDefault && ctx.origin !== "://" && !ctx.origin.startsWith("blob:");
  if (framesOnly && isMain && !ctx.name) continue;
  const res = await send("Runtime.evaluate", {
    expression,
    contextId: ctx.id,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = res.result?.exceptionDetails
    ? `ERROR ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`
    : res.result?.result?.value;
  results.push({ context: ctx.id, origin: ctx.origin, frame: ctx.auxData?.frameId?.slice(0, 8), default: ctx.auxData?.isDefault, value });
}
console.log(JSON.stringify(results, null, 2));
ws.close();
adb("forward", "--remove", `tcp:${PORT}`);

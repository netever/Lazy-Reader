#!/usr/bin/env node
// Checks licenses of npm packages that end up in the app (dependencies, not devDependencies).
// Allowed list: docs/SPEC.md, section 2. Exit code 1 if something is outside the list.
// Usage: npm run licenses
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ALLOWED = new Set([
  "MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "Zlib", "BSL-1.0", "Unicode-3.0",
  "0BSD", "CC0-1.0", "Unlicense", "CDLA-Permissive-2.0", "OFL-1.1", "MPL-2.0",
]);

// SPDX expressions like "(MIT OR Apache-2.0)": OR needs one allowed side, AND needs all.
function allowed(expr) {
  const e = expr.replace(/[()]/g, " ").trim();
  if (/\bOR\b/.test(e)) return e.split(/\bOR\b/).some((x) => allowed(x));
  if (/\bAND\b/.test(e)) return e.split(/\bAND\b/).every((x) => allowed(x));
  return ALLOWED.has(e.trim());
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tree = JSON.parse(
  execFileSync(npm, ["ls", "--omit=dev", "--all", "--json", "--long"], { encoding: "utf8", shell: process.platform === "win32" }),
);

const seen = new Map();
(function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    // Optional platform packages for other systems are listed but not installed.
    if (!dep.version || dep.missing) continue;
    const key = `${name}@${dep.version}`;
    if (seen.has(key)) continue;
    let license = dep.license;
    if (!license && dep.path) {
      try {
        license = JSON.parse(readFileSync(path.join(dep.path, "package.json"), "utf8")).license;
      } catch {
        // reported as unknown below
      }
    }
    seen.set(key, typeof license === "string" ? license : license?.type ?? "UNKNOWN");
    walk(dep);
  }
})(tree);

let bad = 0;
for (const [pkg, license] of [...seen].sort()) {
  const ok = allowed(license);
  if (!ok) bad++;
  console.log(`${ok ? "ok " : "BAD"}  ${pkg}  ${license}`);
}
console.log(`${seen.size} packages, ${bad} outside the allowed list`);
process.exit(bad ? 1 : 0);

import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Storefront performance budget from the spec: INITIAL JS < 150 KB gzip.
// We walk the Vite manifest from the entry through its static imports;
// dynamic imports (e.g. the lazy Sentry chunk) load after first paint and
// are reported separately.
const LIMIT_KB = 150;
const dist = "frontend/storefront/dist";
const manifestPath = join(dist, ".vite/manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`bundle check: ${manifestPath} not found - build the storefront first`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);
if (!entryKey) {
  console.error("bundle check: no entry chunk in manifest");
  process.exit(1);
}

const initial = new Set();
const lazy = new Set();
(function walk(key) {
  if (initial.has(key)) return;
  initial.add(key);
  for (const imp of manifest[key].imports ?? []) walk(imp);
  for (const dyn of manifest[key].dynamicImports ?? []) lazy.add(dyn);
})(entryKey);

const gzKb = (key) =>
  gzipSync(readFileSync(join(dist, manifest[key].file))).length / 1024;

let total = 0;
console.log("storefront INITIAL JS (gzip):");
for (const key of initial) {
  if (!manifest[key].file.endsWith(".js")) continue;
  const kb = gzKb(key);
  total += kb;
  console.log(`  ${manifest[key].file}: ${kb.toFixed(1)} KB`);
}
console.log(`  total: ${total.toFixed(1)} KB / ${LIMIT_KB} KB budget`);

for (const key of lazy) {
  if (initial.has(key) || !manifest[key].file.endsWith(".js")) continue;
  console.log(`  (lazy, not counted) ${manifest[key].file}: ${gzKb(key).toFixed(1)} KB`);
}

if (total > LIMIT_KB) {
  console.error(`FAIL: storefront initial JS exceeds ${LIMIT_KB} KB gzip budget`);
  process.exit(1);
}

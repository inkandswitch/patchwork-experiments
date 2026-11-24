// Loads and builds every scene in vendor/ink-studio/examples with the
// in-browser loader (src/load-scene.js) under Node, and prints one TSV row
// each: file, kind, ok|error, splats, ms, message. Used to pick the examples
// published as docs. Run after `node scripts/toolkit.mjs`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadScene } from "../src/load-scene.js";

const root = fileURLToPath(new URL("../vendor/ink-studio/", import.meta.url));
const toolkit = await import("../src/generated/toolkit.js");
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|json|cjs)$/.test(name) && dir.endsWith("examples")) files[name] = readFileSync(p, "utf8");
  }
})(join(root, "examples"));

const only = process.argv[2];
for (const path of Object.keys(files).sort()) {
  if (only && !path.includes(only)) continue;
  const text = files[path];
  let kind;
  if (path.endsWith(".js") && /^module\.exports\s*=/m.test(text)) kind = "js";
  else if (path.endsWith(".json") && /"solids"\s*:/.test(text)) kind = "diorama";
  else continue;
  const t0 = performance.now();
  try {
    const scene = await loadScene(toolkit, { kind, main: path, files });
    const world = await scene.build(scene.seed);
    console.log([path, kind, "ok", world?.count ?? "", Math.round(performance.now() - t0), scene.name ?? ""].join("\t"));
  } catch (e) {
    console.log([path, kind, "error", "", Math.round(performance.now() - t0), String(e?.message ?? e).split("\n")[0].slice(0, 160)].join("\t"));
  }
}

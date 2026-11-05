#!/usr/bin/env node
/**
 * Check that every copy of a "kit" file matches its canonical copy.
 *
 * Tools here never import each other's source, so small shared modules are
 * copied instead (see scene/README.md, "The kit"). A kit file says so in its
 * header, `[kit: <name> v<N>]`, and the canonical copies live in scene/src/.
 * A copy is any file elsewhere with the same kit name in its header, or (for
 * copies made before the marker existed) the same title line,
 * ` * <name> — …`. Every copy must be byte-identical to the canonical one:
 * to change a kit file, edit the canonical copy, bump its version, and copy it
 * over every other.
 *
 * Usage: node scripts/check-kit.mjs [--fix]
 *   --fix   overwrite every differing copy with the canonical one
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANON_DIR = join(ROOT, "scene", "src");
const SKIP = new Set(["node_modules", "dist", ".git", ".pushwork", ".claude", "static-dist", ".pnpm-store"]);
const fix = process.argv.includes("--fix");

const kitName = (text) => text.slice(0, 600).match(/\[kit: (\S+) v(\d+)\]/);
const titleName = (text) => text.split("\n", 3)[1]?.match(/^ \* (\S+\.js) — /)?.[1] ?? null;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (name.endsWith(".js")) yield p;
  }
}

const canon = new Map(); // kit name → { path, text, version }
for (const name of readdirSync(CANON_DIR)) {
  const path = join(CANON_DIR, name);
  if (!name.endsWith(".js") || statSync(path).isDirectory()) continue;
  const text = readFileSync(path, "utf8");
  const m = kitName(text);
  if (m) canon.set(m[1], { path, text, version: Number(m[2]) });
}

let bad = 0;
let copies = 0;
for (const path of walk(ROOT)) {
  if (dirname(path) === CANON_DIR) continue;
  const text = readFileSync(path, "utf8");
  const name = kitName(text)?.[1] ?? titleName(text);
  const c = name && canon.get(name);
  if (!c) continue;
  copies++;
  if (text === c.text) continue;
  const v = kitName(text)?.[2];
  const why = v ? (Number(v) < c.version ? `is v${v}, canonical is v${c.version}` : `differs from canonical v${c.version}`) : `predates the kit marker (canonical is v${c.version})`;
  if (fix) {
    writeFileSync(path, c.text);
    console.log(`fixed  ${relative(ROOT, path)} (${why})`);
  } else {
    console.log(`DRIFT  ${relative(ROOT, path)} ${why}`);
    bad++;
  }
}

console.log(`${canon.size} kit files, ${copies} copies${bad ? `, ${bad} out of date (run with --fix to copy the canonical ones over)` : ", all match"}`);
if (bad) process.exitCode = 1;

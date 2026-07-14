// Sync every pushwork package under embark/, skipping the ones untouched
// since their last successful sync. Packages are found by their .pushwork
// state dir (core, cards/*, cards/legacy/*). Pass paths to sync a subset:
//   node scripts/sync-packages.mjs [cards/weather ...]
//
// The stamp lives at <pkg>/.pushwork/timestamp — inside the state dir so it
// never ships as package content. Its mtime is the *start* time of the last
// successful sync, so files edited while a sync ran still count as newer on
// the next pass. A failed sync leaves the stamp untouched and the package
// retries next run.

import { existsSync } from "node:fs";
import { readdir, stat, writeFile, utimes } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const CONCURRENCY = 6;
// Never walked: not package content (.pushwork holds sync state whose mtimes
// change on every sync and would defeat the stamp check).
const SKIP_DIRS = new Set(["node_modules", ".git", ".pushwork"]);

const requested = process.argv.slice(2);
const dirs = (
  requested.length > 0
    ? requested.map((p) => path.resolve(root, p))
    : await findPushworkPackages(root)
).filter((dir) => existsSync(path.join(dir, ".pushwork")));
dirs.sort();

const queue = [...dirs];
const failures = [];
let synced = 0;
let skipped = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

if (failures.length > 0) {
  console.error(`\n${failures.length} failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(
  `\n${synced} synced, ${skipped} skipped (${dirs.length} packages).`,
);

async function worker() {
  for (;;) {
    const dir = queue.shift();
    if (!dir) return;
    const name = path.relative(root, dir);
    const stamp = path.join(dir, ".pushwork", "timestamp");

    const stampTime = await mtimeOf(stamp);
    if (stampTime !== undefined) {
      const changed = await firstFileNewerThan(dir, stampTime);
      if (!changed) {
        skipped++;
        console.log(`skip  ${name}`);
        continue;
      }
      console.log(`sync  ${name} (changed: ${path.relative(dir, changed)})`);
    } else {
      console.log(`sync  ${name} (no timestamp yet)`);
    }

    const started = new Date();
    const code = await runPushworkSync(dir);
    if (code === 0) {
      synced++;
      await writeFile(stamp, `${started.toISOString()}\n`);
      await utimes(stamp, started, started);
      console.log(`done  ${name}`);
    } else {
      failures.push(name);
      console.error(`FAIL  ${name} (exit ${code})`);
    }
  }
}

function runPushworkSync(dir) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["pushwork", "sync"], {
      cwd: dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    child.on("close", resolve);
  });
}

// Every directory under `base` carrying a .pushwork state dir. Hidden dirs
// hold no packages; symlinks (pnpm links) are never followed.
async function findPushworkPackages(base) {
  const found = [];
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.some((e) => e.isDirectory() && e.name === ".pushwork")) {
      found.push(dir);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(path.join(dir, entry.name));
    }
  };
  await walk(base);
  return found;
}

// The first file in `dir` modified after `thresholdMs`, or undefined. Short-
// circuits on the first hit; dist/ counts (built artifacts are synced
// content), symlinks don't.
async function firstFileNewerThan(dir, thresholdMs) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name) || entry.name === ".DS_Store") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = await firstFileNewerThan(full, thresholdMs);
      if (hit) return hit;
    } else if (entry.isFile()) {
      const { mtimeMs } = await stat(full);
      if (mtimeMs > thresholdMs) return full;
    }
  }
  return undefined;
}

async function mtimeOf(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

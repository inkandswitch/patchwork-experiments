// Sync every card package with pushwork. The cards live outside the pnpm
// workspace (their manifests carry automerge: dependency specs pnpm cannot
// resolve), so `pnpm -r sync` cannot reach them — this script is the loop.
// Runs a few syncs in parallel; pass paths to sync a subset:
//   node scripts/sync-cards.mjs [cards/weather ...]

import { readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const CONCURRENCY = 6;

const requested = process.argv.slice(2);
const dirs = (
  requested.length > 0
    ? requested.map((p) => path.resolve(root, p))
    : readdirSync(path.join(root, "cards")).map((d) =>
        path.join(root, "cards", d),
      )
).filter((d) => existsSync(path.join(d, ".pushwork")));

const queue = [...dirs];
const failures = [];

async function worker() {
  for (;;) {
    const dir = queue.shift();
    if (!dir) return;
    const name = path.relative(root, dir);
    const code = await new Promise((resolve) => {
      const child = spawn("npx", ["pushwork", "sync"], {
        cwd: dir,
        stdio: ["ignore", "ignore", "inherit"],
      });
      child.on("close", resolve);
    });
    if (code === 0) console.log(`synced ${name}`);
    else {
      failures.push(name);
      console.error(`FAILED ${name} (exit ${code})`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (failures.length > 0) {
  console.error(`\n${failures.length} failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${dirs.length} card packages synced.`);

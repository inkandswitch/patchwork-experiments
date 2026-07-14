// One-off inspection helper: print the module-settings doc's registered module
// urls, marking which ones correspond to a package currently in this workspace
// (core/.pushwork and cards/*/.pushwork rootUrls; parked cards in cards/legacy
// are not scanned, so their registrations read as STALE). Read-only.
//
// Usage (from embark/): node scripts/list-modules.mjs

import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const buckets = ["cards"].map((b) => path.join(here, "..", b));
const standalone = [path.join(here, "..", "core")];

const settingsUrl = JSON.parse(
  readFileSync(path.join(here, "..", "module-settings.json"), "utf8"),
).moduleSettingsDocUrl;

const local = new Map(); // url -> bucket/name
for (const dir of standalone) {
  try {
    const cfg = JSON.parse(
      readFileSync(path.join(dir, ".pushwork", "config.json"), "utf8"),
    );
    if (cfg.rootUrl) local.set(cfg.rootUrl, path.basename(dir));
  } catch {
    // not pushed yet
  }
}
for (const bucket of buckets) {
  for (const dir of readdirSync(bucket)) {
    try {
      const cfg = JSON.parse(
        readFileSync(path.join(bucket, dir, ".pushwork", "config.json"), "utf8"),
      );
      if (cfg.rootUrl) local.set(cfg.rootUrl, `${path.basename(bucket)}/${dir}`);
    } catch {
      // not a pushwork package
    }
  }
}

const dataDir = path.join(here, ".automerge-data");
mkdirSync(dataDir, { recursive: true });
await import("@automerge/automerge-subduction");
const { Repo } = await import("@automerge/automerge-repo");
const { NodeFSStorageAdapter } = await import(
  "@automerge/automerge-repo-storage-nodefs"
);
const repo = new Repo({
  storage: new NodeFSStorageAdapter(dataDir),
  subductionWebsocketEndpoints: [
    process.env.SUBDUCTION_SERVER ?? "wss://subduction.sync.inkandswitch.com",
  ],
});

const handle = await repo.find(settingsUrl);
await handle.whenReady();
const modules = [...(handle.doc().modules ?? [])];

console.log(`module-settings doc: ${settingsUrl} (${modules.length} modules)\n`);
for (const url of modules) {
  const name = local.get(url);
  console.log(`  ${name ? "LOCAL " : "STALE "} ${url}  ${name ?? ""}`);
}
const unregistered = [...local].filter(([url]) => !modules.includes(url));
if (unregistered.length) {
  console.log("\nnot yet registered:");
  for (const [url, name] of unregistered) console.log(`  ${name}  ${url}`);
}

await repo.flush();
await repo.shutdown();
process.exit(0);

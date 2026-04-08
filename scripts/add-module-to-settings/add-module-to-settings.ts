/**
 * Push a module URL onto a module-settings doc's `modules` array (Subduction).
 *
 * Run from anywhere (after `pnpm install` here):
 *   /path/to/patchwork-tools/scripts/add-module-to-settings/register-module \
 *     "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"
 *
 * Args must be full `automerge:…` URLs (invalid URLs fail when opening the doc).
 *
 * Env: SUBDUCTION_SERVER, AUTOMERGE_DATA_DIR (default: <this-folder>/automerge-repo-data)
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { AutomergeUrl } from "@automerge/automerge-repo";

type ModuleSettingsDoc = { modules?: AutomergeUrl[] };

const here = path.dirname(fileURLToPath(import.meta.url));

const [, , settingsArg, moduleArg] = process.argv;
if (!settingsArg || !moduleArg) {
  console.error(`Usage: register-module <automerge:settings-url> <automerge:module-url>

Env: SUBDUCTION_SERVER, AUTOMERGE_DATA_DIR`);
  process.exit(1);
}

const subductionServer =
  process.env.SUBDUCTION_SERVER ?? "wss://subduction.sync.inkandswitch.com";
const dataDir = path.resolve(
  process.env.AUTOMERGE_DATA_DIR ?? path.join(here, "automerge-repo-data"),
);
await mkdir(dataDir, { recursive: true });

await import("@automerge/automerge-subduction");
const { Repo } = await import("@automerge/automerge-repo");
const { NodeFSStorageAdapter } =
  await import("@automerge/automerge-repo-storage-nodefs");

const settingsUrl = settingsArg as AutomergeUrl;
const moduleUrl = moduleArg as AutomergeUrl;

const repo = new Repo({
  storage: new NodeFSStorageAdapter(dataDir),
  subductionWebsocketEndpoints: [subductionServer],
  periodicSyncInterval: 2000,
  batchSyncInterval: 0,
});

const handle = await repo.find<ModuleSettingsDoc>(settingsUrl);
await handle.whenReady();

let added = false;
handle.change((doc) => {
  if (!doc.modules) doc.modules = [];
  if (!doc.modules.includes(moduleUrl)) {
    doc.modules.push(moduleUrl);
    added = true;
  }
});

await repo.flush();
await repo.shutdown();
await new Promise((r) => setTimeout(r, 2500));

console.log(
  added
    ? `Added ${moduleUrl} → ${settingsUrl}`
    : `${moduleUrl} already in ${settingsUrl}`,
);

// Subduction leaves the wss TLSSocket open after repo.shutdown(); exit explicitly for this CLI.
process.exit(0);

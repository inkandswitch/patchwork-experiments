// Self-contained module-settings registrar for the embark workspace.
//
// Reads every pushed feature package's pushwork rootUrl (core/.pushwork and
// cards/*/.pushwork/config.json; cards/legacy is skipped as it holds parked,
// unconverted cards) and writes them into a module-settings
// Automerge doc over the Subduction sync server, deduping. No external CLI
// (pw-modules) required; it uses the same automerge-repo + subduction stack
// pushwork itself uses.
//
// The module-settings doc URL is resolved by precedence:
//   1. first positional argument
//   2. $MODULE_SETTINGS_DOC_URL
//   3. moduleSettingsDocUrl in module-settings.json (this dir's parent)
//   4. interactive prompt (only on a TTY) — the answer is saved to the config
//      file so subsequent runs don't ask again. Leave the prompt blank to
//      create a fresh settings doc.
//
// Usage (run from embark/):
//   node scripts/register-modules.mjs                          resolve url (prompt first time), add all packages
//   node scripts/register-modules.mjs <settings-url>           add all packages to an explicit doc
//   node scripts/register-modules.mjs <settings-url> --remove automerge:OLD ...
//   node scripts/register-modules.mjs init                     create a new settings doc, save + print its url
//
// Env: SUBDUCTION_SERVER (default wss://subduction.sync.inkandswitch.com)
//      AUTOMERGE_DATA_DIR (default scripts/.automerge-data)

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
// Pushwork packages are the per-card packages under cards/ plus the single
// core package (which holds every editor and context host as one module).
// cards/legacy has no .pushwork at its top level, so it falls out naturally.
const bucketDirs = [path.join(here, "..", "cards")];
const standalonePackages = [path.join(here, "..", "core")];
const configPath = path.join(here, "..", "module-settings.json");
const AUTOMERGE_URL_RE = /^automerge:[1-9A-HJ-NP-Za-km-z]+$/;

function readPackageUrls() {
  const urls = [];
  for (const pkgDir of standalonePackages) {
    try {
      const cfg = path.join(pkgDir, ".pushwork", "config.json");
      const rootUrl = JSON.parse(readFileSync(cfg, "utf8")).rootUrl;
      if (rootUrl && AUTOMERGE_URL_RE.test(rootUrl)) {
        urls.push({ name: path.basename(pkgDir), url: rootUrl });
      }
    } catch {
      // not pushed yet
    }
  }
  for (const bucketDir of bucketDirs) {
    let entries;
    try {
      entries = readdirSync(bucketDir);
    } catch {
      continue; // bucket dir may not exist
    }
    for (const dir of entries) {
      const cfg = path.join(bucketDir, dir, ".pushwork", "config.json");
      let rootUrl;
      try {
        rootUrl = JSON.parse(readFileSync(cfg, "utf8")).rootUrl;
      } catch {
        continue; // lib / non-pushed packages have no .pushwork
      }
      if (rootUrl && AUTOMERGE_URL_RE.test(rootUrl)) {
        urls.push({ name: dir, url: rootUrl });
      }
    }
  }
  return urls.sort((a, b) => a.name.localeCompare(b.name));
}

function readConfiguredUrl() {
  try {
    const url = JSON.parse(readFileSync(configPath, "utf8")).moduleSettingsDocUrl;
    return url && AUTOMERGE_URL_RE.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

function saveConfiguredUrl(url) {
  writeFileSync(
    configPath,
    JSON.stringify({ moduleSettingsDocUrl: url }, null, 2) + "\n",
  );
  console.error(
    `Saved module-settings doc url to ${path.relative(process.cwd(), configPath)}`,
  );
}

async function promptForSettingsUrl() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (
        await rl.question(
          "No module-settings doc configured.\n" +
            "Enter an existing module-settings automerge URL, or leave blank to create a new one:\n> ",
        )
      ).trim();
      if (answer === "") {
        rl.close();
        return await init(); // create a fresh doc and use it
      }
      if (AUTOMERGE_URL_RE.test(answer)) return answer;
      console.error(`"${answer}" is not a valid automerge: URL. Try again.`);
    }
  } finally {
    rl.close();
  }
}

// arg > $MODULE_SETTINGS_DOC_URL > config file > interactive prompt (saved).
async function resolveSettingsUrl(argUrl) {
  if (argUrl) {
    if (!AUTOMERGE_URL_RE.test(argUrl)) {
      console.error(`Invalid settings url: ${argUrl}`);
      process.exit(1);
    }
    return argUrl;
  }

  const envUrl = process.env.MODULE_SETTINGS_DOC_URL;
  if (envUrl) {
    if (!AUTOMERGE_URL_RE.test(envUrl)) {
      console.error(`Invalid MODULE_SETTINGS_DOC_URL: ${envUrl}`);
      process.exit(1);
    }
    return envUrl;
  }

  const configured = readConfiguredUrl();
  if (configured) return configured;

  if (!process.stdin.isTTY) {
    console.error(
      "No module-settings url configured. Pass one as an argument, set " +
        "MODULE_SETTINGS_DOC_URL, add it to module-settings.json, or run " +
        "`node scripts/register-modules.mjs init`.",
    );
    process.exit(1);
  }

  const url = await promptForSettingsUrl();
  saveConfiguredUrl(url);
  return url;
}

async function openRepo() {
  const subductionServer =
    process.env.SUBDUCTION_SERVER ?? "wss://subduction.sync.inkandswitch.com";
  const dataDir = path.resolve(
    process.env.AUTOMERGE_DATA_DIR ?? path.join(here, ".automerge-data"),
  );
  mkdirSync(dataDir, { recursive: true });

  await import("@automerge/automerge-subduction");
  const { Repo } = await import("@automerge/automerge-repo");
  const { NodeFSStorageAdapter } = await import(
    "@automerge/automerge-repo-storage-nodefs"
  );

  return new Repo({
    storage: new NodeFSStorageAdapter(dataDir),
    subductionWebsocketEndpoints: [subductionServer],
  });
}

// Subduction's local head stability doesn't confirm server receipt; give it a
// moment to land before tearing down (mirrors pushwork's own CLI).
async function syncAndShutdown(repo) {
  await new Promise((r) => setTimeout(r, 1000));
  await repo.flush();
  await repo.shutdown();
  await new Promise((r) => setTimeout(r, 2500));
}

async function init() {
  const repo = await openRepo();
  const handle = repo.create({
    "@patchwork": { type: "patchwork:module-settings" },
    modules: [],
  });
  await handle.whenReady();
  const url = handle.url;
  await syncAndShutdown(repo);
  console.error(`Created module-settings doc: ${url}`);
  console.log(url); // bare url on stdout: MODULE_SETTINGS_DOC_URL=$(node scripts/register-modules.mjs init)
  return url;
}

async function sync(settingsUrl, removeUrls) {
  const packages = readPackageUrls();
  if (packages.length === 0) {
    throw new Error(
      "No published packages found (core/.pushwork, cards/*/.pushwork/config.json). Sync core and the cards first.",
    );
  }

  const repo = await openRepo();
  const handle = await repo.find(settingsUrl);
  await handle.whenReady();

  const added = [];
  const removed = [];
  handle.change((doc) => {
    if (!doc.modules) doc.modules = [];
    for (const { url } of packages) {
      if (!doc.modules.includes(url)) {
        doc.modules.push(url);
        added.push(url);
      }
    }
    for (const url of removeUrls) {
      const idx = doc.modules.indexOf(url);
      if (idx !== -1) {
        doc.modules.splice(idx, 1);
        removed.push(url);
      }
    }
  });

  const finalModules = [...(handle.doc().modules ?? [])];
  await syncAndShutdown(repo);

  for (const { name, url } of packages) {
    const tag = added.includes(url) ? "added" : "already present";
    console.log(`  @embark/${name.padEnd(20)} ${url}  (${tag})`);
  }
  for (const url of removed) console.log(`  removed ${url}`);
  console.log(
    `\nDone. ${added.length} added, ${removed.length} removed. ` +
      `${finalModules.length} modules now in ${settingsUrl}.`,
  );
}

const [, , first, ...rest] = process.argv;

if (first === "init") {
  const url = await init();
  saveConfiguredUrl(url);
} else {
  const argUrl = first && first !== "--remove" ? first : undefined;
  const settingsUrl = await resolveSettingsUrl(argUrl);

  const removeUrls = [];
  const flagArgs = argUrl ? rest : [first, ...rest].filter(Boolean);
  for (let i = 0; i < flagArgs.length; i++) {
    if (flagArgs[i] === "--remove" && flagArgs[i + 1]) {
      removeUrls.push(flagArgs[++i]);
    }
  }
  await sync(settingsUrl, removeUrls);
}

// Subduction leaves the wss socket open after shutdown; exit explicitly.
process.exit(0);

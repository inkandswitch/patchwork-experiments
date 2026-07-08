// One-off migration: point every card at the single @embark/core package.
// The context store and the two extension hosts used to be three separately
// synced packages; cards referenced them by three automerge urls. They now
// live in core/ under one pushwork root, with the client at client.js and the
// host channel definitions at channels/{codemirror,map}.js.
//
// Reads the core url from core/.pushwork/config.json, so run it after
// `pushwork init` in core/.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const CORE_URL = JSON.parse(
  readFileSync(path.join(root, "core", ".pushwork", "config.json"), "utf8"),
).rootUrl;
if (!CORE_URL?.startsWith("automerge:")) {
  throw new Error("core has no pushwork rootUrl yet");
}

const OLD_STORE = "automerge:3vaj7PCyQyz5Qt2nwJXj4zoiZML9";
const OLD_CM_HOST = "automerge:2aJuokeFMcxkyG8u2SqLcaAqfZvQ";
const OLD_MAP_HOST = "automerge:SC11CtdnwHBT1oZqr7ibz4JAQM2";
const OLD_DEP_NAMES = [
  "@embark/context",
  "@embark/codemirror-extensions-host",
  "@embark/map-extensions-host",
];

for (const dir of readdirSync(path.join(root, "cards"))) {
  const cardDir = path.join(root, "cards", dir);

  const pkgFile = path.join(cardDir, "package.json");
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    let hadPlatformDep = false;
    for (const name of OLD_DEP_NAMES) {
      if (pkg.dependencies?.[name]) {
        delete pkg.dependencies[name];
        hadPlatformDep = true;
      }
    }
    if (hadPlatformDep) {
      pkg.dependencies["@embark/core"] = CORE_URL;
      writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
      console.log(`deps    cards/${dir}/package.json`);
    }
  }

  for (const file of readdirSync(cardDir)) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const filePath = path.join(cardDir, file);
    const before = readFileSync(filePath, "utf8");
    let src = before;

    // Host channel imports move to core-root subpaths. Do the call sites
    // before the generic identifier/url swaps so the subpath rewrite can key
    // off the old constant names.
    src = src.replace(
      /getImportableUrlFromAutomergeUrl\(\s*CODEMIRROR_HOST_PACKAGE_URL,\s*"channels\.js"\s*\)/g,
      'getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/codemirror.js")',
    );
    src = src.replace(
      /getImportableUrlFromAutomergeUrl\(\s*MAP_HOST_PACKAGE_URL,\s*"channels\.js"\s*\)/g,
      'getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/map.js")',
    );

    // Drop the now-redundant host url constants; CORE_PACKAGE_URL (the renamed
    // context store constant, below) covers them.
    src = src.replace(
      /[ \t]*\/\/[^\n]*\n(?=const (?:CODEMIRROR_HOST|MAP_HOST)_PACKAGE_URL)/g,
      "",
    );
    src = src.replace(
      /[ \t]*const (?:CODEMIRROR_HOST|MAP_HOST)_PACKAGE_URL =\s*"automerge:[^"]+";\n/g,
      "",
    );

    src = src.replaceAll("CONTEXT_PACKAGE_URL", "CORE_PACKAGE_URL");
    src = src.replaceAll(OLD_STORE, CORE_URL);
    // Any leftover literal host urls (comments, unusual call shapes).
    src = src.replaceAll(OLD_CM_HOST, CORE_URL);
    src = src.replaceAll(OLD_MAP_HOST, CORE_URL);

    if (src !== before) {
      writeFileSync(filePath, src);
      console.log(`rewrote cards/${dir}/${file}`);
    }
  }
}

console.log(`\ncore url: ${CORE_URL}`);

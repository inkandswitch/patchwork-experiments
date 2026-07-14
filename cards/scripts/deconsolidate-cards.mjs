// One-off migration: revert the converted cards from the single shared cards
// root back to standalone per-card pushwork packages.
//
// - Static relative imports become dynamic automerge-url imports:
//   `import { A } from "../platform.js"` -> `const { A } = await import(
//   getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js"))` (or
//   channels/codemirror.js / channels/map.js depending on the names), and
//   `import { X } from "../<sibling>/<path>"` -> the sibling's package url.
// - channels.js attributions go back to each card's own PACKAGE_URL.
// - package.json regains automerge dependencies (core + imported siblings)
//   and the sync/register scripts.
// - Header comments describing the shared-root import story are rewritten.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cardsRoot = path.join(here, "..", "cards");

const CORE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

// URL const names for generated code, matching the inspect skills' examples.
const CONST_NAME = {
  "commands-card": "COMMANDS_PACKAGE_URL",
  "geo-markers-card": "GEO_MARKERS_PACKAGE_URL",
  "geo-shapes-card": "GEO_SHAPES_PACKAGE_URL",
  "geo-zoom-card": "GEO_ZOOM_PACKAGE_URL",
  "mentions-card": "MENTIONS_PACKAGE_URL",
  "open-documents": "OPEN_DOCUMENTS_PACKAGE_URL",
  poi: "POI_PACKAGE_URL",
  route: "ROUTE_PACKAGE_URL",
  schedule: "SCHEDULE_PACKAGE_URL",
  "schema-matcher": "SCHEMA_MATCHER_PACKAGE_URL",
  selection: "SELECTION_PACKAGE_URL",
  "stickers-card": "STICKERS_CARD_PACKAGE_URL",
};

// Which core module each platform.js re-export actually lives in.
const CLIENT_NAMES = new Set([
  "findContextStore",
  "subscribeContext",
  "getContextHandle",
  "ownerOf",
  "requireOwner",
]);
const CORE_CHANNEL_MODULE = {
  CodemirrorExtensions: "channels/codemirror.js",
  MapExtensions: "channels/map.js",
};

const HELPER_IMPORT =
  'import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";';

const dirs = readdirSync(cardsRoot).filter(
  (d) =>
    d !== "legacy" && existsSync(path.join(cardsRoot, d, "package.json")),
);

// Own pushwork rootUrl per card dir.
const dirUrl = {};
for (const dir of dirs) {
  const cfg = path.join(cardsRoot, dir, ".pushwork", "config.json");
  dirUrl[dir] = JSON.parse(readFileSync(cfg, "utf8")).rootUrl;
}

const RELATIVE_IMPORT = /^import \{([^}]+)\} from "\.\.\/([^"]+)";$/gm;

function awaitImportBlock(names, constName, subpath) {
  return `const { ${names} } = await import(\n  getImportableUrlFromAutomergeUrl(${constName}, "${subpath}")\n);`;
}

for (const dir of dirs) {
  const cardDir = path.join(cardsRoot, dir);
  const usedDeps = new Set(); // "core" or sibling dir names

  for (const file of readdirSync(cardDir)) {
    if (!file.endsWith(".js")) continue;
    const filePath = path.join(cardDir, file);
    const before = readFileSync(filePath, "utf8");
    let src = before;

    // channels.js: attribution back to this card's own url.
    if (file === "channels.js") {
      src = src.replace(
        'const CARDS_PACKAGE_URL = "automerge:__CARDS_URL__";',
        `const PACKAGE_URL = "${dirUrl[dir]}";`,
      );
      src = src.replaceAll(`\${CARDS_PACKAGE_URL}/${dir}/`, "${PACKAGE_URL}/");
    }

    // Static relative imports -> dynamic automerge-url imports.
    const neededConsts = new Map(); // constName -> url
    let first = true;
    src = src.replace(RELATIVE_IMPORT, (whole, names, target) => {
      const list = names.replace(/\s+/g, " ").trim().replace(/,$/, "");
      const blocks = [];

      if (target === "platform.js") {
        usedDeps.add("core");
        neededConsts.set("CORE_PACKAGE_URL", CORE_URL);
        const client = [];
        for (const name of list.split(/,\s*/)) {
          if (CLIENT_NAMES.has(name)) {
            client.push(name);
          } else if (CORE_CHANNEL_MODULE[name]) {
            blocks.push(
              awaitImportBlock(
                name,
                "CORE_PACKAGE_URL",
                CORE_CHANNEL_MODULE[name],
              ),
            );
          } else {
            throw new Error(`unknown platform export ${name} in ${dir}/${file}`);
          }
        }
        if (client.length) {
          blocks.unshift(
            awaitImportBlock(client.join(", "), "CORE_PACKAGE_URL", "client.js"),
          );
        }
      } else {
        const slash = target.indexOf("/");
        const sibling = target.slice(0, slash);
        const subpath = target.slice(slash + 1);
        if (!CONST_NAME[sibling]) {
          throw new Error(`unknown sibling ${sibling} in ${dir}/${file}`);
        }
        usedDeps.add(sibling);
        neededConsts.set(CONST_NAME[sibling], dirUrl[sibling]);
        blocks.push(awaitImportBlock(list, CONST_NAME[sibling], subpath));
      }

      let out = blocks.join("\n");
      if (first) {
        first = false;
        out = "__PREAMBLE__" + out;
      }
      return out;
    });

    // Helper import + url consts ahead of the first dynamic import.
    if (src.includes("__PREAMBLE__")) {
      const decls = [...neededConsts]
        .map(([name, url]) => `const ${name} = "${url}";`)
        .join("\n");
      src = src.replace("__PREAMBLE__", `${HELPER_IMPORT}\n\n${decls}\n\n`);
    }

    // Header comments: shared-root story -> per-package automerge urls.
    src = src.replace(
      "channel\n// definitions and the context-store client are imported with plain relative paths (all cards share one package).",
      "channel\n// definitions and the context-store client are imported by automerge url.",
    );
    src = src.replace(
      "channel\n// packages are imported with plain relative paths (all cards share one package).",
      "channel\n// definitions from sibling packages are imported by their automerge urls.",
    );
    src = src.replace(
      "sibling\n// cards are imported with relative paths (every card lives in the one shared\n// cards package) and the core platform comes from ../platform.js.",
      "sibling\n// cards and the core platform are imported by their automerge urls.",
    );
    src = src.replace(
      "importmap-provided, relative (sibling cards), or from ../platform.js.",
      "importmap-provided or imported by automerge url (sibling cards, core).",
    );

    if (src !== before) {
      writeFileSync(filePath, src);
      console.log(`rewrote ${dir}/${file}`);
    }
  }

  // package.json: automerge deps + per-root scripts.
  const pkgFile = path.join(cardDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  const deps = {};
  if (usedDeps.has("core")) deps["@embark/core"] = CORE_URL;
  for (const sibling of [...usedDeps].filter((d) => d !== "core").sort()) {
    deps[`@embark/${sibling}`] = dirUrl[sibling];
  }
  pkg.scripts = {
    ...pkg.scripts,
    sync: "pushwork sync",
    register: 'pw-modules add "$MODULE_SETTINGS_DOC_URL" "$(pushwork url)"',
  };
  if (Object.keys(deps).length) pkg.dependencies = deps;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`updated ${dir}/package.json`);
}

// Anything still pointing at the shared root is a smell — report it.
console.log("\n--- leftover relative/placeholder references:");
for (const dir of dirs) {
  const cardDir = path.join(cardsRoot, dir);
  for (const file of readdirSync(cardDir)) {
    if (!file.endsWith(".js")) continue;
    const text = readFileSync(path.join(cardDir, file), "utf8");
    for (const m of text.matchAll(/from "\.\.\/[^"]+"|__CARDS_URL__/g)) {
      console.log(`  ${dir}/${file}: ${m[0]}`);
    }
  }
}

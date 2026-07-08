// One-off migration: collapse the 23 per-card pushwork roots into ONE cards
// package with relative imports.
//
// - `await import(getImportableUrlFromAutomergeUrl(<CONST>, "sub/path.js"))`
//   becomes a static relative import: core urls -> ../platform.js (the single
//   bridge module), sibling-card urls -> ../<dir>/<sub/path.js>.
// - Now-unused url constants and the filesystem-helper import are dropped.
// - channels.js `definedBy`/`spec` attributions switch from per-card urls to
//   `${CARDS_PACKAGE_URL}/<dir>/...` with a __CARDS_URL__ placeholder that is
//   baked in after `pushwork init` mints the root url.
// - Per-card package.json manifests lose their automerge dependencies and
//   sync/register scripts (kept: name/exports, which pnpm link: consumers use).

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cardsRoot = path.join(here, "..", "cards");

const CORE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

// Old per-card pushwork rootUrl -> directory under cards/.
const URL_TO_DIR = {
  "automerge:2nay83Kjg393HEaXwerXpHMnDDWw": "bird-sighting",
  "automerge:asYz1WKN9GHigxdQPVVfr5h8MuW": "commands-card",
  "automerge:27NZacXx1DQVusdWaNS9US9t5spB": "currency-converter",
  "automerge:2qhWc5S2pg83z2xutpiCkafYkdSN": "doc-finder",
  "automerge:FBLNJtT5p4RcTEFErfZTNjswqNP": "geo-lines-card",
  "automerge:25PPbHiDGuNmsTGSvCgiPnas8iqD": "geo-markers-card",
  "automerge:7tDif9cz12ZQXv55Yo73io1UUw4": "geo-shapes-card",
  "automerge:3daZBaqA2YR5nEhTmRQoYz6coLhV": "geo-zoom-card",
  "automerge:2xYFYSsg6LhiPE719qB6nCZT9Zyh": "mentions-card",
  "automerge:2otX5sW1C3cozUnmGiKZKviSHAaQ": "metric-converter",
  "automerge:472iiEQWMcQp48hdNQAoDuvhS1cx": "open-documents",
  "automerge:eXE2Kjh1YkQEkYS6aAMoAAfYZXn": "page-url",
  "automerge:r1gkpehGtt4WTR1pz7mBac9SnJp": "poi",
  "automerge:uMCUHr7SvWiwF1YtmZsWhnUhWY2": "pointer",
  "automerge:41HBbYkbrqYd9STaojjQUsFc1jDW": "route",
  "automerge:3jBqTXqoHp8pyXeUZKbXcJch7qxm": "schedule",
  "automerge:x5C77Bg2ivBhDnAHoupCKb6cDYC": "schema-matcher",
  "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW": "selection",
  "automerge:2BkapPQei7cVRiWryrVPQEQQKCJ9": "stickerable",
  "automerge:2Tjy4kfsDHyv7xLCZtuf8dHAWbDy": "stickers-card",
  "automerge:3wGbMYtuZ7EtBvDsbuwRBcP6v7P2": "timer-source",
  "automerge:2YXL4FwZ7crmDpgcm2FobPGpQyE7": "unit-converter",
  "automerge:2gtsy4b6hU38DQAMPk6kYHLwxrxE": "weather",
};

const AWAIT_IMPORT =
  /const\s*\{([^}]+)\}\s*=\s*await import\(\s*getImportableUrlFromAutomergeUrl\((\w+),\s*"([^"]+)"\),?\s*\);\n?/g;

const dirs = readdirSync(cardsRoot).filter((d) =>
  existsSync(path.join(cardsRoot, d, "package.json")),
);

for (const dir of dirs) {
  const cardDir = path.join(cardsRoot, dir);

  // --- package.json: strip automerge deps and per-root scripts
  const pkgFile = path.join(cardDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  let pkgChanged = false;
  if (pkg.dependencies) {
    delete pkg.dependencies;
    pkgChanged = true;
  }
  for (const s of ["sync", "register"]) {
    if (pkg.scripts?.[s]) {
      delete pkg.scripts[s];
      pkgChanged = true;
    }
  }
  if (pkg.scripts && Object.keys(pkg.scripts).length === 0) {
    delete pkg.scripts;
    pkgChanged = true;
  }
  if (pkgChanged) writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");

  // --- source files
  for (const file of readdirSync(cardDir)) {
    if (!file.endsWith(".js")) continue;
    const filePath = path.join(cardDir, file);
    const before = readFileSync(filePath, "utf8");
    let src = before;

    // channels.js: re-attribute definedBy/spec to the shared cards root.
    if (file === "channels.js") {
      src = src.replace(
        /const PACKAGE_URL = "automerge:[A-Za-z0-9]+";/,
        'const CARDS_PACKAGE_URL = "automerge:__CARDS_URL__";',
      );
      src = src.replaceAll("${PACKAGE_URL}/", `\${CARDS_PACKAGE_URL}/${dir}/`);
    }

    // Dynamic platform/sibling imports -> static relative imports.
    const constNames = new Set(
      [...src.matchAll(/const (\w+) = "automerge:[A-Za-z0-9]+";/g)].map(
        (m) => m[1],
      ),
    );
    const constUrl = Object.fromEntries(
      [...src.matchAll(/const (\w+) = "(automerge:[A-Za-z0-9]+)";/g)].map(
        (m) => [m[1], m[2]],
      ),
    );

    src = src.replace(AWAIT_IMPORT, (whole, names, constName, subpath) => {
      const url = constUrl[constName];
      let rel;
      if (url === CORE_URL) {
        rel = "../platform.js";
      } else if (URL_TO_DIR[url]) {
        rel = `../${URL_TO_DIR[url]}/${subpath}`;
      } else {
        return whole; // unknown target, leave for manual review
      }
      const list = names.replace(/\s+/g, " ").trim().replace(/,$/, "");
      return `import { ${list} } from "${rel}";\n`;
    });

    // Drop url constants that nothing references anymore.
    for (const name of constNames) {
      const uses = src.split(name).length - 1;
      if (uses === 1) {
        src = src.replace(
          new RegExp(`const ${name} = "automerge:[A-Za-z0-9]+";\\n`),
          "",
        );
      }
    }

    // Drop the filesystem helper import when it became unused.
    if (
      src.split("getImportableUrlFromAutomergeUrl").length - 1 === 1 &&
      /import \{ getImportableUrlFromAutomergeUrl \} from "@inkandswitch\/patchwork-filesystem";\n/.test(
        src,
      )
    ) {
      src = src.replace(
        /import \{ getImportableUrlFromAutomergeUrl \} from "@inkandswitch\/patchwork-filesystem";\n/,
        "",
      );
    }

    if (src !== before) {
      writeFileSync(filePath, src);
      console.log(`rewrote ${dir}/${file}`);
    }
  }
}

// Leftover absolute urls in card sources are a smell — report them.
console.log("\n--- leftover automerge: references in cards/*/*.js:");
for (const dir of dirs) {
  const cardDir = path.join(cardsRoot, dir);
  for (const file of readdirSync(cardDir)) {
    if (!file.endsWith(".js") && !file.endsWith(".d.ts")) continue;
    const text = readFileSync(path.join(cardDir, file), "utf8");
    for (const m of text.matchAll(/automerge:[A-Za-z0-9]{20,}/g)) {
      console.log(`  ${dir}/${file}: ${m[0]}`);
    }
  }
}

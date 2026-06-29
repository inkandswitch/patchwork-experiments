#!/usr/bin/env node
/**
 * Aggregate every patchwork-tools tool's built `dist/` into a single static,
 * HTTP-servable directory plus a `modules.json` manifest.
 *
 * The manifest has the same shape as a Patchwork module-settings document
 * (`{ "@patchwork": { type: "patchwork:module-settings" }, modules: [...] }`)
 * but lives as a plain JSON file. Each module entry is a relative URL to a
 * tool's entry-point JS, resolved the same way the runtime resolves an
 * Automerge folder doc's package.json (`exports["."]` under the
 * `patchwork`/`browser`/`import` conditions, falling back to `main`).
 *
 * This only aggregates; it does not install or build. Build the tools first
 * (`node scripts/build-static.mjs --build`, or build them individually), then
 * run this to assemble `static-dist/`. Tools without a resolvable, already-built
 * entry point are skipped (and reported), so a half-built tree still produces a
 * usable bundle of whatever did build.
 *
 * Usage:
 *   node scripts/bundle.mjs [--out <dir>]
 *
 *   --out <dir>   Output directory (default: static-dist)
 */
import { existsSync, readFileSync, rmSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

// Conditions mirror `defaultImportConditions` in
// @inkandswitch/patchwork-filesystem so static resolution matches runtime.
const CONDITIONS = ["patchwork", "browser", "import"];

// Directories that are never tools. `libraries/` holds shared JS libraries
// (consumed by tools), not Patchwork tools themselves, so it never ships.
const IGNORE_DIRS = new Set([
  "node_modules",
  "scripts",
  "static-dist",
  "dist",
  "libraries",
  ".git",
  ".pushwork",
]);

function parseArgs(argv) {
  const args = { out: "static-dist" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

/**
 * Resolve a package.json `exports`/`main` for the root subpath under our
 * import conditions. Returns a path relative to the package root (e.g.
 * "./dist/index.js") or undefined.
 */
function resolveEntry(pkg) {
  const exp = pkg.exports;
  const fromExports = exp ? resolveExportValue(exp["."] ?? exp) : undefined;
  if (fromExports) return fromExports;
  if (typeof pkg.main === "string") return pkg.main;
  return undefined;
}

function resolveExportValue(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  for (const cond of CONDITIONS) {
    if (cond in value) {
      const resolved = resolveExportValue(value[cond]);
      if (resolved) return resolved;
    }
  }
  if ("default" in value) return resolveExportValue(value.default);
  return undefined;
}

function normalizeRel(p) {
  return p.replace(/^\.\//, "").replace(/^\//, "");
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const outDir = resolvePath(ROOT, out);
  const toolsOutDir = join(outDir, "tools");

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(toolsOutDir, { recursive: true });

  // Copy dists and build manifest.
  const modules = [];
  const skipped = [];

  for (const name of readdirSync(ROOT).sort()) {
    if (IGNORE_DIRS.has(name) || name.startsWith(".")) continue;
    const toolDir = join(ROOT, name);
    if (!statSync(toolDir).isDirectory()) continue;

    const pkgPath = join(toolDir, "package.json");
    if (!existsSync(pkgPath)) {
      skipped.push(`${name} (no package.json)`);
      continue;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

    const entry = resolveEntry(pkg);
    if (!entry) {
      skipped.push(`${name} (no resolvable entry point in package.json)`);
      continue;
    }

    const entryRel = normalizeRel(entry);
    if (!existsSync(join(toolDir, entryRel))) {
      skipped.push(`${name} (entry ${entryRel} not found — built?)`);
      continue;
    }

    const destDir = join(toolsOutDir, name);
    mkdirSync(destDir, { recursive: true });

    const entryTopDir = entryRel.includes("/") ? entryRel.split("/")[0] : null;
    if (entryTopDir) {
      // Entry is in a subdirectory (e.g. dist/index.js) — copy that dir + package.json.
      cpSync(join(toolDir, entryTopDir), join(destDir, entryTopDir), { recursive: true });
      cpSync(pkgPath, join(destDir, "package.json"));
    } else {
      // Entry is at root (e.g. index.js) — copy source files directly.
      const SKIP = new Set(["node_modules", ".git", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
      cpSync(toolDir, destDir, {
        recursive: true,
        filter: (src) => {
          if (src === toolDir) return true;
          return !SKIP.has(src.slice(toolDir.length + 1).split("/")[0]);
        },
      });
    }

    modules.push(`./tools/${name}/${entryRel}`);
    console.log(`[ok]    ${name} -> ./tools/${name}/${entryRel}`);
  }

  const manifest = {
    "@patchwork": { type: "patchwork:module-settings" },
    modules,
  };
  writeFileSync(join(outDir, "modules.json"), JSON.stringify(manifest, null, 2) + "\n");

  // The shell loads these tools cross-origin, and module `import()` is always a
  // CORS request, so the tools host must allow it. `_headers` is read by Netlify
  // (and Cloudflare Pages), so the bundle is portable across static hosts.
  writeFileSync(
    join(outDir, "_headers"),
    ["/*", "  Access-Control-Allow-Origin: *", ""].join("\n")
  );

  console.log(`\nWrote ${modules.length} modules to ${join(outDir, "modules.json")}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
}

main();

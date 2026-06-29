#!/usr/bin/env node
/**
 * Orchestrate the static tools bundle for patchwork-tools.
 *
 * patchwork-tools is intentionally NOT a pnpm workspace (see README): it is a
 * flat collection of *independent* tools, each with its own pnpm-lock.yaml and
 * node_modules, each buildable on its own. So rather than `pnpm -r build`, this
 * walks each top-level tool directory and runs that tool's own
 * `pnpm install` / `pnpm build`, continuing past failures, then hands off to
 * scripts/bundle.mjs to aggregate every built `dist/` into `static-dist/`
 * (`modules.json` + `tools/<tool>/…` + `_headers`).
 *
 * Because tools are heterogeneous (some are bundleless, some are WIP), a tool
 * that has no `build` script is left as-is, and a tool whose build fails is
 * reported but does not abort the run — bundle.mjs simply skips any tool that
 * lacks a resolvable, already-built entry point. Pass --strict to fail the run
 * if any tool's install/build fails.
 *
 * Usage:
 *   node scripts/build-static.mjs                 # bundle already-built tools
 *   node scripts/build-static.mjs --build         # build each tool, then bundle
 *   node scripts/build-static.mjs --install       # install + build each tool, then bundle
 *   node scripts/build-static.mjs --filter <name> # restrict to tools whose dir name includes <name> (repeatable)
 *   node scripts/build-static.mjs --strict         # exit non-zero if any tool fails
 *   node scripts/build-static.mjs --out <dir>      # output dir (default: static-dist)
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

// Mirror bundle.mjs: directories that are never tools. `libraries/` holds
// shared JS libraries consumed by tools, not Patchwork tools themselves.
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
  const args = { out: "static-dist", install: false, build: false, strict: false, filters: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--install") args.install = true;
    else if (a === "--build") args.build = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--filter") args.filters.push(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  // --install implies --build (no point installing without building).
  if (args.install) args.build = true;
  return args;
}

function listToolDirs(filters) {
  return readdirSync(ROOT)
    .sort()
    .filter((name) => {
      if (IGNORE_DIRS.has(name) || name.startsWith(".")) return false;
      const dir = join(ROOT, name);
      if (!statSync(dir).isDirectory()) return false;
      if (!existsSync(join(dir, "package.json"))) return false;
      if (filters.length && !filters.some((f) => name.includes(f))) return false;
      return true;
    });
}

function readPkg(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function run(cmd, args, cwd, extraEnv) {
  const res = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  return res.status === 0;
}

// pnpm 11 blocks dependency build scripts by default (the "Ignored build
// scripts: esbuild, cbor-extract …" warning). On a clean CI checkout that can
// leave native deps (esbuild, cbor-extract, @swc/core, core-js …) unbuilt and
// fail a tool's build. patchwork-base approves these via its single workspace
// `allowBuilds`; patchwork-tools isn't a workspace and most tools don't, so we
// approve all builds for the orchestrated install. In v11 the only global,
// non-interactive lever is `dangerouslyAllowAllBuilds` (the per-allowlist
// `onlyBuiltDependencies` env was removed). This only affects installs run by
// this script — a tool's own `pnpm install` is unchanged. Override by exporting
// `npm_config_dangerously_allow_all_builds` yourself.
const INSTALL_ENV = {
  npm_config_dangerously_allow_all_builds:
    process.env.npm_config_dangerously_allow_all_builds ?? "true",
};

function main() {
  const { out, install, build, strict, filters } = parseArgs(process.argv.slice(2));
  const tools = listToolDirs(filters);

  const failures = [];
  const built = [];
  const noBuild = [];

  if (install || build) {
    console.log(
      `\n${install ? "Installing + building" : "Building"} ${tools.length} tool(s)` +
        (filters.length ? ` (filter: ${filters.join(", ")})` : "") +
        "\n"
    );

    for (const name of tools) {
      const dir = join(ROOT, name);
      const pkg = readPkg(dir);
      const hasBuild = !!pkg?.scripts?.build;

      if (install) {
        console.log(`\n── install ${name} ──`);
        if (!run("pnpm", ["install"], dir, INSTALL_ENV)) {
          console.error(`[fail]  ${name}: pnpm install`);
          failures.push(`${name} (install)`);
          continue;
        }
      }

      if (!hasBuild) {
        // Bundleless tools (single .js at root) have nothing to build.
        noBuild.push(name);
        continue;
      }

      console.log(`\n── build ${name} ──`);
      if (run("pnpm", ["build"], dir)) {
        built.push(name);
      } else {
        console.error(`[fail]  ${name}: pnpm build`);
        failures.push(`${name} (build)`);
      }
    }
  }

  // Aggregate whatever built into static-dist/.
  console.log(`\n── aggregating into ${out} ──`);
  const bundleOk = run("node", [join(ROOT, "scripts", "bundle.mjs"), "--out", out], ROOT);

  // Summary.
  if (install || build) {
    console.log(
      `\nBuilt ${built.length}, bundleless/no-build ${noBuild.length}, failed ${failures.length}.`
    );
    if (failures.length) {
      console.log("Failed tools:");
      for (const f of failures) console.log(`  - ${f}`);
    }
  }

  if (!bundleOk) process.exit(1);
  if (strict && failures.length) process.exit(1);
}

main();

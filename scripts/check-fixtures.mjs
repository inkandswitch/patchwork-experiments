#!/usr/bin/env node
/**
 * Check that every test fixture one package keeps as a copy of another's
 * export still matches it.
 *
 * Packages never import each other's source, so a package that tests against
 * another's data keeps a copy, and the exporting package keeps the script
 * that writes it (walk/DESIGN.md, "The sloop's static checks without a
 * build-time link"). A stale copy is still a valid arena for its tests; it
 * only stops being what it is named for. Run by the integrator.
 *
 * Usage: node scripts/check-fixtures.mjs [--fix]
 *   --fix   overwrite every differing copy with a fresh export
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** [the exporting package, its script, the copy] */
const FIXTURES = [["sailing", "probes/export-deck.mjs", "walk/src/test/fixtures/deck-12m.json"]];
const fix = process.argv.includes("--fix");

let bad = 0;
for (const [pkg, script, copy] of FIXTURES) {
  const fresh = execFileSync(process.execPath, [script], { cwd: join(ROOT, pkg), maxBuffer: 64 << 20 }).toString();
  const have = readFileSync(join(ROOT, copy), "utf8");
  if (fresh === have) {
    console.log(`ok    ${copy} (${pkg}/${script})`);
    continue;
  }
  bad++;
  if (fix) writeFileSync(join(ROOT, copy), fresh);
  console.log(`${fix ? "fixed" : "STALE"} ${copy}: differs from ${pkg}/${script}'s export`);
}
process.exit(bad && !fix ? 1 : 0);

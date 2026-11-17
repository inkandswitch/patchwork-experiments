// The package stands alone (CLAUDE.md, "Every folder is a separate tool"):
// no file of it, source, test or probe, imports anything outside its own
// folder by a relative path. Every .js, .mjs and .html file is read and every
// import specifier in it checked: the whole package, nothing sampled. The one
// thing a probe page may name outside it is another package's built plugin
// entry (`../../<package>/dist/index.js`), which it loads at run time as
// Patchwork's registry does: a late-bound lookup, never another package's
// source.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", "dist", ".pushwork", ".git"]);
/** A probe page loading another package's built plugin entry, as the registry would. */
const pluginEntry = (file, s) => file.startsWith(join(ROOT, "probes") + sep) && file.endsWith(".html") && /^\.\.\/\.\.\/[a-z0-9-]+\/dist\/index\.js$/.test(s);

function files(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) files(p, out);
    else if (/\.(m?js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Every module specifier a file names: static imports and exports, side-effect imports, import(). */
export function specifiers(text) {
  const out = [];
  for (const re of [/\b(?:import|export)\s[^"'`;]*?\sfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g])
    for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

describe("the package stands alone", () => {
  it("the specifier reader finds every form", () => {
    const q = '"';
    const text = [`import a from ${q}./a.js${q};`, `import { b } from '../b.js';`, `export * from ${q}./c.js${q};`, `import ${q}./d.js${q};`, `await import(${q}../../e.js${q});`].join(" ");
    expect(specifiers(text)).toEqual(["./a.js", "../b.js", "./c.js", "./d.js", "../../e.js"]);
  });

  const all = files(ROOT);
  it(`reads every file (${all.length})`, () => expect(all).toEqual(expect.arrayContaining([join(ROOT, "src", "index.js"), join(ROOT, "src", "standalone.test.js")])));
  for (const f of all)
    it(`${relative(ROOT, f)} imports nothing outside the package`, () => {
      const outside = specifiers(readFileSync(f, "utf8"))
        .filter((s) => s.startsWith(".") && !pluginEntry(f, s))
        .filter((s) => {
          const to = resolve(dirname(f), s);
          return to !== ROOT && !to.startsWith(ROOT + sep);
        });
      expect(outside).toEqual([]);
    });
});

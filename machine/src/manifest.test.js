// The package's manifest says what its code needs, and no more: every
// dependency and peer dependency is imported by some module under src/
// that isn't a test. (Tests take theirs from devDependencies.)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function* modules(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* modules(p);
    else if (/\.(js|ts)$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

test("every dependency and peer dependency is imported by the package's own code", () => {
  const imported = new Set();
  for (const f of modules(join(root, "src")))
    for (const m of readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"'./][^"']*)["']/g)) {
      const parts = m[1].split("/");
      imported.add(m[1].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})];
  expect(declared.filter((d) => !imported.has(d))).toEqual([]);
});

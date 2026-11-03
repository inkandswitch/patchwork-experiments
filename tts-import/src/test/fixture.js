// The tiny-mod fixture (fixtures/tiny-mod, from fixtures/make-tiny-mod.mjs)
// as importer sources, read from disk.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { source } from "../importer.js";

export const FIXTURE = fileURLToPath(new URL("../../fixtures/tiny-mod", import.meta.url));

export function fixtureSources({ only = null, without = [] } = {}) {
  const out = [];
  const walkDir = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkDir(p);
      else {
        const rel = relative(FIXTURE, p);
        if (only && !only.some((o) => rel.startsWith(o))) continue;
        if (without.some((w) => rel.includes(w))) continue;
        out.push(source(rel, statSync(p).size, async () => new Uint8Array(readFileSync(p))));
      }
    }
  };
  walkDir(FIXTURE);
  return out;
}

export const fixtureSave = () => JSON.parse(readFileSync(join(FIXTURE, "Workshop/1234567890.json"), "utf8"));

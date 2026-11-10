// A stand-in for @inkandswitch/patchwork-filesystem (vitest.config.ts aliases
// it here): importPackage answers from a table a test fills.
//
//   import { servePackage, imported, resetPackagesServed } from "../test/filesystem-mock.js";
//   servePackage("automerge:…", { plugins: [...] });   // or an Error, to fail
//
// A package is looked up by its bare URL; `imported` records the URLs
// importPackage was really called with (heads and all).

const served = new Map();
export const imported = [];

export function servePackage(url, module) {
  served.set(url, module);
}

export function resetPackagesServed() {
  served.clear();
  imported.length = 0;
}

export async function importPackage(url) {
  imported.push(url);
  const bare = String(url).split("#")[0];
  const m = served.get(bare);
  if (m instanceof Error) throw m;
  if (!m) throw new Error(`nothing to import at ${bare}`);
  return typeof m === "function" ? m() : m;
}

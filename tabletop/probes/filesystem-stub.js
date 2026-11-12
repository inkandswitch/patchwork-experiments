// Stand-in for the host's @inkandswitch/patchwork-filesystem (mapped by the
// probe's importmap): importPackage really imports a module, from where the
// page said that package is served. `imported` records what it was asked for
// (heads and all).
const served = new Map();
export const imported = [];
/** Serve the package at this bare URL from this module URL. */
export function servePackage(url, moduleUrl) {
  served.set(url, moduleUrl);
}
export async function importPackage(url) {
  imported.push(url);
  const bare = String(url).split("#")[0];
  if (!served.has(bare)) throw new Error(`no package at ${bare}`);
  return import(served.get(bare));
}

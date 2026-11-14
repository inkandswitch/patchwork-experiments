// A stand-in for @inkandswitch/patchwork-filesystem (vitest.config.js aliases
// it here): the host provides the real one through its importmap. Tests that
// load a package mock link/package.js's loadPackage instead; reaching this
// means a test loaded one without saying what it holds.
export async function importPackage(url) {
  throw new Error(`no package at ${url} in a test`);
}

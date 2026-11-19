// A stand-in for @inkandswitch/patchwork-filesystem, which the host provides
// through its importmap (vitest.config aliases it here): loading a package
// in a test is the test's own loadPackage (table/load-package.js's shape).
export async function importPackage(url) {
  throw new Error(`no host to import ${url} from in a test`);
}

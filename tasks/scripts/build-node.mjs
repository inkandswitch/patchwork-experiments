// Builds the task framework for Node: the process that lends a queue its
// workers from a machine with no browser (src/node/host.ts), and the jobs
// client for a Node program that asks a queue for work.
//
//   node scripts/build-node.mjs      →  dist-node/
//
// The router, the pool and the worker are the browser's, unchanged. What
// differs is the one file that says where a worker's Repo and its code come
// from, and this puts Node's (src/node/webworker-lib.node.ts) in its place.
import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeLib = resolve(root, "src/node/webworker-lib.node.ts");

await build({
  absWorkingDir: root,
  entryPoints: {
    host: "src/node/host.ts",
    "thread-router": "src/node/thread-router.ts",
    "thread-pool": "src/node/thread-pool.ts",
    "thread-worker": "src/node/thread-worker.ts",
    "job-client": "src/job-client.ts",
  },
  outdir: "dist-node",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // the Repo comes from node_modules at run time: it brings wasm and a socket library
  external: ["@automerge/automerge-repo-node"],
  define: { __TASKS_BUILD__: JSON.stringify(Date.now()) },
  // a CommonJS dependency bundled into an ES module still asks for `require`
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  plugins: [
    {
      name: "node-webworker-lib",
      setup(b) {
        b.onResolve({ filter: /^\.\.?\/webworker-lib$/ }, () => ({ path: nodeLib }));
      },
    },
  ],
});

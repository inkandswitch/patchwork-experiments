// Builds the task system for Node: the host that runs a machine's pool from a
// process (src/node/host.ts), the run worker its threads run
// (src/node/run-thread.ts), and the task client (src/client.js: the client,
// the rules and the run helpers) for a Node program that is not a pool.
//
//   node scripts/build-node.mjs      →  dist-node/
//
// The run worker is the browser's, unchanged. What differs is the one file
// that says where its Repo and its code come from, and this puts Node's
// (src/node/webworker-lib.node.ts) in its place.
import { build } from "esbuild";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeLib = resolve(root, "src/node/webworker-lib.node.ts");

// what an older build left behind would otherwise sit beside this one
rmSync(resolve(root, "dist-node"), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: {
    host: "src/node/host.ts",
    "run-thread": "src/node/run-thread.ts",
    "task-client": "src/client.js",
  },
  outdir: "dist-node",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // The Repo and its storage come from node_modules at run time: they bring
  // wasm and a socket library. A task's code is handed that same Repo
  // package and the Automerge it uses (src/node/task-imports.ts), which a
  // copy bundled in here would not be. So is the plugin registry, which the
  // host and its threads fill and task code asks; and core's ModuleWatcher
  // comes from there too.
  external: [
    "@automerge/automerge-repo-node",
    "@automerge/automerge-repo-storage-nodefs",
    "@inkandswitch/patchwork-plugins",
    "@inkandswitch/patchwork-filesystem",
  ],
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

import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a worker,
// so it must stay free of DOM and bare imports. Everything else is behind a
// load() and ends up in lazily-loaded chunks. CSS is imported with `?inline`
// and injected by the tool on mount. The scene builds run in a module worker
// (src/build-worker.js, started from a `?worker&url` import): vite bundles it
// into one import-free ES file, and with `base: "./"` its URL resolves next to
// the chunk that starts it, wherever the bundle is served from.
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    target: "es2022",
    minify: false,
    sourcemap: false,
    // no modulepreload helper: it touches `document`, and the entry runs in a worker
    modulePreload: false,
    emptyOutDir: true,
    rollupOptions: {
      external,
      input: "./src/index.js",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
});

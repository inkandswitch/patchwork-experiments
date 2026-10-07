import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a
// worker, so it must stay free of DOM and bare imports. The editor, the
// raymarcher and the scene provider are lazily-loaded chunks. The mesher runs
// in its own module worker, bundled by vite from
// `new Worker(new URL("./mesh-worker.js", import.meta.url), { type: "module" })`;
// with `base: "./"` its URL resolves next to the chunk that spawns it, so it
// works wherever the bundle is served from (including inside the scene tool).
// CSS is imported with `?inline` and injected by the tool on mount.
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    target: "es2022",
    minify: true,
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

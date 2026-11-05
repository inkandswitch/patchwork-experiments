import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a worker,
// so it must stay free of DOM and bare imports. Everything else (three.js and
// clipper-lib included — neither is in the importmap) is bundled into
// lazily-loaded chunks. CSS is imported with `?inline` and injected by the tool
// on mount.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    minify: true,
    sourcemap: false,
    // No modulepreload helper: it touches `document`, and the entry runs in a worker.
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

import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a worker,
// so it must stay free of DOM and bare imports. Everything else (three.js
// included — it is not in the importmap) is bundled into lazily-loaded chunks.
// CSS is imported with `?inline` and injected by each tool on mount.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    // three.js makes the tool chunk big; minify it and skip sourcemaps so the
    // synced bundle stays small. No modulepreload helper: it touches `document`.
    minify: true,
    sourcemap: false,
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

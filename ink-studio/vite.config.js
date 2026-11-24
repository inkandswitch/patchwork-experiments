import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a
// worker, so it stays free of DOM and bare imports. The tool, the toolkit
// (src/generated/toolkit.js, made by scripts/toolkit.mjs) and upstream's WebGL
// renderer are lazily loaded chunks.
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    target: "es2022",
    minify: true,
    sourcemap: false,
    modulePreload: false,
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
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

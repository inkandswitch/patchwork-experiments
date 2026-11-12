import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a
// worker, so it must stay free of DOM and bare imports. CSS is imported with
// `?inline` and injected by the tool on mount (this package has none).
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
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

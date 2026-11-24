import { defineConfig } from "vite";

// Everything the tool needs ships in dist: three.js, rhino3dm and its
// WebAssembly. base "./" keeps every chunk, worker and asset URL relative to
// the module's own location, since Patchwork serves the package from any URL.
export default defineConfig({
  base: "./",
  worker: {
    format: "es",
    rollupOptions: {
      output: { entryFileNames: "assets/[name]-[hash].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name][extname]" },
    },
  },
  build: {
    target: "es2022",
    minify: true,
    sourcemap: false,
    modulePreload: false, // its helper touches `document`, and the entry is read in a worker
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: "./index.js",
      output: { format: "es", entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js", assetFileNames: "assets/[name][extname]" },
      preserveEntrySignatures: "strict",
    },
  },
});

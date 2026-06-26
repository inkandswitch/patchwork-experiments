import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import externals from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [solidPlugin(), cssInjectedByJsPlugin()],
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      // patchwork-* + automerge are provided by the host importmap.
      // patchwork-providers is NOT externalized (not in the importmap) so it's
      // bundled in. Recognition layers (incl. their WASM workers) live in
      // SEPARATE physical-layer packages, so the frame has no vendored assets.
      external: externals,
      input: "./src/index.ts",
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

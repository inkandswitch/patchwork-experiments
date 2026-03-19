import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import solid from "vite-plugin-solid";

import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [solid(), cssInjectedByJsPlugin()],

  esbuild: {
    target: "es2022",
  },

  build: {
    target: "es2022",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external,
      input: {
        index: "./src/index.ts",
      },
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

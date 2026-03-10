import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

import external from "@inkandswitch/patchwork-bootloader/externals";
import snapshot from "./.pushwork/snapshot.json";

export default defineConfig({
  base: "./",
  plugins: [topLevelAwait(), wasm(), react(), cssInjectedByJsPlugin()],

  define: {
    __ROOT_DIR_URL__: JSON.stringify(snapshot.rootDirectoryUrl),
  },

  esbuild: {
    target: 'es2022',
  },

  build: {
    target: 'es2022',
    rollupOptions: {
      external,
      input: {
        index: "./src/index.ts",
        "p3net/index": "./src/p3net/lib.ts",
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

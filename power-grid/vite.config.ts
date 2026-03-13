import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

import external from "@inkandswitch/patchwork-bootloader/externals";
import snapshot from "./.pushwork/snapshot.json";

export default defineConfig({
  base: "./",
  plugins: [
    topLevelAwait(),
    wasm(),
    react(),
    // Inject shared CSS into the main entry so it's available before any tool
    // is lazily loaded. Without this, vite-plugin-css-injected-by-js picks an
    // arbitrary entry (e.g. skills/markdown/index.js) and the tool CSS never
    // loads when Patchwork opens a p3net view.
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (chunk) => chunk.fileName === 'index.js',
    }),
  ],

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
        "petrinet-llm-process/index": "./src/petrinet-llm-process/index.ts",
        "skills/power-grid/index": "./src/skills/power-grid/index.ts",
        "skills/markdown/index": "./src/skills/markdown/index.ts",
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

import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import solid from "vite-plugin-solid";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import external from "@inkandswitch/patchwork-bootloader/externals";

// The second entry is the reply's task (src/generate-task.js), at
// dist/generate-task.js in every build: a task names its code by that path,
// and a pool imports it in a run worker or a Node thread, so it imports
// nothing but Automerge's Repo, which the page's import map or the host
// resolves.
export default defineConfig({
  base: "./",
  plugins: [topLevelAwait(), wasm(), solid(), cssInjectedByJsPlugin({ relativeCSSInjection: true })],

  esbuild: {
    target: "es2022",
  },

  build: {

    cssCodeSplit: true,
    target: "es2022",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external,
      input: {
        index: "./src/index.ts",
        "generate-task": "./src/generate-task.js",
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

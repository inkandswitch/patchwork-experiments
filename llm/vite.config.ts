import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import solid from "vite-plugin-solid";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import external from "@inkandswitch/patchwork-bootloader/externals";
import formalSketchSkillsSnapshot from "../formal-sketch-skills/.pushwork/snapshot.json";

export default defineConfig({
  base: "./",
  plugins: [topLevelAwait(), wasm(), solid(), cssInjectedByJsPlugin()],

  define: {
    __FORMAL_SKETCH_SKILLS_FOLDER_URL__: JSON.stringify(formalSketchSkillsSnapshot.rootDirectoryUrl),
  },

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

import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import solid from "vite-plugin-solid";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import external from "@inkandswitch/patchwork-bootloader/externals";
import llmSnapshot from "./.pushwork/snapshot.json";

const skillsFolderUrl = llmSnapshot.directories.find(
  ([name]: [string, unknown]) => name === "skills",
)?.[1]?.url;

if (!skillsFolderUrl) {
  throw new Error("Could not find 'skills' directory in llm/.pushwork/snapshot.json");
}

export default defineConfig({
  base: "./",
  plugins: [topLevelAwait(), wasm(), solid(), cssInjectedByJsPlugin()],

  define: {
    __SKILLS_FOLDER_URL__: JSON.stringify(skillsFolderUrl),
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

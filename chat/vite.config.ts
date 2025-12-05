import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), cssInjectedByJsPlugin()],

  build: {
    rollupOptions: {
      external(id) {
        return !!id.match(/^((@automerge\/automerge(-repo)?)|@patchwork\/.*)$/);
      },
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

  worker: {
    format: "es",
    rollupOptions: {
      // Don't externalize dependencies for workers - let them use their own imports
      external: [],
      output: {
        format: "es",
      },
    },
  },
});

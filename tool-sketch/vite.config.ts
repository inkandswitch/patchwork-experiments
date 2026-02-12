import external from "@inkandswitch/patchwork-bootloader/externals";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (outputChunk) => outputChunk.name === "main",
    }),
  ],

  build: {
    minify: false,
    rollupOptions: {
      external,
      input: {
        main: "./src/main.tsx",
        tool: "./src/tool.tsx",
        datatype: "./src/datatype.ts",
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

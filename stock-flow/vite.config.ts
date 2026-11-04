import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  build: {
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external,
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

import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import topLevelAwait from "vite-plugin-top-level-await";

import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    dts({
      entryRoot: "src",
      rollupTypes: true,
      tsconfigPath: "tsconfig.json",
    }),
    topLevelAwait(),
  ],
  build: {
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

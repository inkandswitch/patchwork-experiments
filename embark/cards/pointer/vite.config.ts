import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        card: "src/card.ts",
        plugins: "src/plugins.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

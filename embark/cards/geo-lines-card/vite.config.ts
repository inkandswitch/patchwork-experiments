import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [solidPlugin()],
  build: {
    lib: {
      entry: { index: "src/index.ts", card: "src/card.tsx" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

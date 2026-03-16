import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  base: "./",
  plugins: [solidPlugin()],

  build: {
    minify: false,
    rollupOptions: {
      external(id) {
        return !!id.match(/^((@automerge\/automerge(-repo)?)|@inkandswitch\/.*)$/);
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
});

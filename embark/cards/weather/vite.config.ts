import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // The card entry carries the card behavior; the board/token tools use inline
    // styles, so inject any CSS into card.js.
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (chunk) => chunk.fileName === "card.js",
    }),
  ],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        card: "src/card.tsx",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

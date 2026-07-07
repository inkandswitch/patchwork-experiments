import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // Inject the CSS into every entry (index.js AND plugins.js). Without the
    // filter the plugin picks a single entry — it chose plugins.js, which only
    // runs during worker plugin discovery (no document), so consumers bundling
    // dist/index.js (stickers-card, todo) lost the sticker styles.
    cssInjectedByJsPlugin({ jsAssetsFilterFunction: (chunk) => chunk.isEntry }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", plugins: "src/plugins.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

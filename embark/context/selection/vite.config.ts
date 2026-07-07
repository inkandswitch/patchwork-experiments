import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // Inject the CSS into every entry — with multiple entries and no filter
    // the plugin picks one arbitrarily (it landed in tokens.js), leaving the
    // other entry points without the token styles.
    cssInjectedByJsPlugin({ jsAssetsFilterFunction: (chunk) => chunk.isEntry }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", tokens: "src/tokens.tsx", plugins: "src/plugins.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

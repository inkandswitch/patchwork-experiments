import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // Inject the CSS into every entry — with multiple entries and no filter
    // the plugin picks one arbitrarily, leaving the other without the styles.
    cssInjectedByJsPlugin({ jsAssetsFilterFunction: (chunk) => chunk.isEntry }),
  ],
  build: {
    lib: {
      // TokenView is its own entry so other packages can import the render
      // function directly (`@embark/token-view/TokenView`) — e.g. the mention
      // menu, whose tooltip lives outside the repo-provider tree where a
      // <patchwork-view> can't resolve its repo.
      entry: { index: "src/index.ts", TokenView: "src/TokenView.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

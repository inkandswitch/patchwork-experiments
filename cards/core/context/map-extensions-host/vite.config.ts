import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The host is a plain function the map tool calls, but this package also ships
// the `map-extension` context view (loaded lazily by the context viewer), so
// the build runs the CSS-injection plugin. maplibre is used type-only here, so
// nothing heavy lands in the bundle.
export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // Inject the CSS into every entry — with multiple entries and no filter
    // the plugin puts it only in plugins.js, which never runs in the page.
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

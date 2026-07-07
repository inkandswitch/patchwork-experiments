import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  // Baked-in build stamp, rendered by the inspector so you can tell at a
  // glance whether the running bundle is the one you just synced.
  define: {
    __BUILD_TIME__: JSON.stringify(
      new Date().toLocaleString("sv-SE").slice(0, 16),
    ),
  },
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

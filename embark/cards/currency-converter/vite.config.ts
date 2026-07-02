import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // Keep all injected CSS on the component entry (it renders the board card);
    // index.js only registers the plugin.
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (chunk) => chunk.fileName === "component.js",
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts", component: "src/component.tsx" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

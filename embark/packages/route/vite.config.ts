import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // Keep all injected CSS on the component entry (it renders the board card);
    // the standalone view.js is a dependency-free token face that must not carry
    // the card's styles, and index.js only registers the plugin.
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (chunk) => chunk.fileName === "component.js",
    }),
  ],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        component: "src/component.tsx",
        view: "src/view.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

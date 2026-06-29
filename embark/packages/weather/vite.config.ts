import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

export default defineConfig({
  base: "./",
  plugins: [
    solidPlugin(),
    // The component entry renders the feature card and pulls in weather.css;
    // index.js only registers plugins, and the board/token tools use inline
    // styles, so the component entry is the only one that needs injected CSS.
    cssInjectedByJsPlugin({
      jsAssetsFilterFunction: (chunk) => chunk.fileName === "component.js",
    }),
  ],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        component: "src/component.tsx",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The host itself is a plain codemirror extension, but this package also ships
// the `codemirror-extension` context view (loaded lazily by the context
// viewer), so the build runs the CSS-injection plugin. CodeMirror and Solid are
// externalized (see the bootloader externals), so the host shares the runtime's
// single codemirror/solid instances.
export default defineConfig({
  base: "./",
  plugins: [solidPlugin(), cssInjectedByJsPlugin()],
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

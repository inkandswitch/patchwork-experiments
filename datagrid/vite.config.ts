import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import external from "@inkandswitch/patchwork-bootloader/externals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bundle react-hooks with our React copy. If left external, the host's React
// instance won't match the bundled one used by createRoot/Handsontable.
const moduleExternals = external.filter(
  (dep) => dep !== "@automerge/automerge-repo-react-hooks"
);

export default defineConfig({
  base: "./",
  plugins: [react(), cssInjectedByJsPlugin({ relativeCSSInjection: true })],

  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-runtime"
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-dev-runtime"
      ),
    },
  },

  build: {

    cssCodeSplit: true,
    minify: false,
    rollupOptions: {
      external: moduleExternals,
      input: "./src/index.ts",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
});

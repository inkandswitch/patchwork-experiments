import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import tailwindcss from "@tailwindcss/vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import external from "@inkandswitch/patchwork-bootloader/externals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function localBuildTimestamp(): string {
  return new Date().toLocaleString();
}

const moduleExternals = external.filter(
  (dep) => dep !== "@automerge/automerge-repo-react-hooks",
);

export default defineConfig({
  base: "./",
  define: {
    __CARD_TABLE_BUILT_AT__: JSON.stringify(localBuildTimestamp()),
  },
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    tailwindcss(),
    cssInjectedByJsPlugin(),
  ],

  esbuild: {
    target: "es2022",
  },

  optimizeDeps: {
    esbuildOptions: {
      target: "es2022",
    },
  },

  resolve: {
    alias: {
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-runtime",
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "node_modules/react/jsx-dev-runtime",
      ),
    },
  },

  build: {
    minify: false,
    target: "es2022",
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

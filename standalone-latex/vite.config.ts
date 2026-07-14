import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import bootloaderExternals from "@inkandswitch/patchwork-bootloader/externals";
import path from "path";

// The tool bundles its own React (react isn't in the host importmap), so
// the react-hooks package must be bundled too — otherwise the host-served
// copy runs against the host's React and hooks crash with a null
// dispatcher. Its automerge-repo imports stay external, so handles still
// resolve to the host's repo instance.
const external = bootloaderExternals.filter(
  (name) => name !== "@automerge/automerge-repo-react-hooks"
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
      external,
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

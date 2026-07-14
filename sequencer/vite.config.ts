import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig({
  base: "./",
  server: {
    port: 5558,
  },

  build: {

    cssCodeSplit: true,
    sourcemap: "inline",
    target: "esnext",
    assetsInlineLimit: 500000, // Inline audio samples as base64 for faster first play
    rollupOptions: {
      external: [
        "@automerge/automerge",
        "@automerge/automerge/slim",
        "@automerge/automerge-repo",
        "@automerge/automerge-repo/slim",
        "@automerge/automerge-repo-keyhive",
        "@keyhive/keyhive",
        "@keyhive/keyhive/slim",
        "@inkandswitch/patchwork-bootloader",
        "@inkandswitch/patchwork-elements",
        "@inkandswitch/patchwork-filesystem",
        "@inkandswitch/patchwork-plugins",

        // CodeMirror deps
        "@codemirror/commands",
        "@codemirror/state",
        "@codemirror/view",
        "@codemirror/language",
        "@lezer/common",
        "@marijn/find-cluster-break",
      ],
      input: "./src/main.tsx",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },

  plugins: [wasm(), react(), cssInjectedByJsPlugin({ relativeCSSInjection: true })],

  worker: {
    format: "es",
    plugins: () => [wasm()],
  },
});

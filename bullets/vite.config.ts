import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  define: {
    __BULLETS_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [solid(), cssInjectedByJsPlugin()],
  build: {
    sourcemap: "inline",
    target: "esnext",
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
        "solid-js",
        "solid-js/html",
        "solid-js/web",
        "solid-js/h",
        "solid-js/store",
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
});

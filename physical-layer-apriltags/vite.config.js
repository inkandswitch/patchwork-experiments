import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import externals from "@inkandswitch/patchwork-bootloader/externals";

const here = dirname(fileURLToPath(import.meta.url));

// The AprilTag detector runs in a classic Web Worker (vendor/apriltag.js uses
// importScripts("apriltag_wasm.js") / importScripts("comlink.js") — string args
// Vite can't trace). The emscripten glue then loads apriltag_wasm.wasm relative
// to itself. So copy these three siblings next to the emitted worker chunk.
function copyWorkerSiblings() {
  return {
    name: "copy-apriltag-worker-siblings",
    closeBundle() {
      const assets = join(here, "dist", "assets");
      mkdirSync(assets, { recursive: true });
      for (const f of ["apriltag_wasm.js", "apriltag_wasm.wasm", "comlink.js"]) {
        copyFileSync(join(here, "vendor", f), join(assets, f));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [cssInjectedByJsPlugin(), copyWorkerSiblings()],
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      external: externals,
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

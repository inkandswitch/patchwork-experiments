import { defineConfig } from "vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import externals from "@inkandswitch/patchwork-bootloader/externals";

const here = dirname(fileURLToPath(import.meta.url));

// Vite emits vendor/apriltag.js as a worker chunk into dist/assets/, but it
// loads its dependencies with importScripts("apriltag_wasm.js") /
// importScripts("comlink.js") — string args Vite can't trace. The emscripten
// glue then loads apriltag_wasm.wasm relative to itself. So we must copy these
// three siblings next to the emitted worker chunk in dist/assets/.
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
  plugins: [solidPlugin(), cssInjectedByJsPlugin(), copyWorkerSiblings()],
  // The AprilTag detector runs in a classic Web Worker (vendor/apriltag.js uses
  // importScripts), loaded via `new Worker(new URL("../vendor/apriltag.js",
  // import.meta.url))`. We do NOT bundle it as a module worker.
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      // patchwork-* + automerge are provided by the host importmap.
      // patchwork-providers is NOT externalized (not in the importmap) so it's
      // bundled in. The vendored wasm/worker/comlink are emitted as assets.
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

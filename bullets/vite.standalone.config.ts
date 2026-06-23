import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    outDir: "dist-standalone",
  },
  // Force a single copy of these packages. The linked standalone frame would
  // otherwise resolve its own node_modules copies, giving the subduction and
  // automerge wasm modules separate (uninitialized) instances.
  resolve: {
    dedupe: [
      "@automerge/automerge",
      "@automerge/automerge-repo",
      "@automerge/automerge-repo-keyhive",
      "@automerge/automerge-subduction",
      "solid-js",
    ],
  },
  define: {
    __BULLETS_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5560,
    open: "/",
    watch: {
      ignored: ["!**/node_modules/@automerge/automerge-repo-keyhive/**"],
    },
  },
  plugins: [
    wasm(),
    solid(),
  ],
});

import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import bootloaderExternals from "@inkandswitch/patchwork-bootloader/externals";

// The installed bootloader's externals list lags behind the live host
// importmap (it predates solid-js being host-provided), so we extend it with
// everything the host actually serves. Anything host-provided MUST be external
// — especially solid-js: bundling a second copy would give us a separate
// reactive runtime and break every signal. We bundle only our own non-host
// deps (perfect-freehand, roughjs, automerge-repo-solid-primitives).
const HOST_PROVIDED = new Set([
  ...bootloaderExternals,
  "solid-js",
  "solid-js/web",
  "solid-js/html",
  "solid-js/h",
  "solid-js/store",
  "solid-js/jsx-runtime",
  "solid-js/store/dist/server.js",
  "@automerge/automerge-subduction",
  "@automerge/automerge-subduction/slim",
  "@automerge/automerge-repo-react-hooks",
]);

function isHostProvided(id) {
  return (
    HOST_PROVIDED.has(id) ||
    id === "solid-js" ||
    id.startsWith("solid-js/") ||
    id.startsWith("@automerge/automerge/") ||
    id.startsWith("@automerge/automerge-repo/")
  );
}

export default defineConfig({
  base: "./",
  plugins: [solidPlugin(), cssInjectedByJsPlugin()],
  build: {
    minify: false,
    // inline the Caroni woff2 (~29kB) into the injected CSS as a data URI, so the
    // font travels inside the bundle (no separate asset request to serve)
    assetsInlineLimit: 100000,
    rollupOptions: {
      external: isHostProvided,
      input: "./src/index.jsx",
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

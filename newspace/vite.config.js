import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import patchworkBundles from "@chee/patchwork-bundles/vite";
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
  // CodeMirror core is host-provided via the importmap — these MUST be external so
  // we share ONE instance with the host (facet / StateField identity matters; a
  // second copy breaks every extension). The bootloader externals list only has
  // state+view (it lags), so add language too. The lang packs / commands / search
  // are NOT host-provided and bundle normally (they import the external core).
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
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
  // patchworkBundles() rewrites the `automerge:`-versioned dep
  // (@chee/patchwork-transcript) to a shared service-worker URL marked external,
  // so the lib + its worker load as ONE copy shared across tools (not per-tool).
  plugins: [solidPlugin(), cssInjectedByJsPlugin(), patchworkBundles()],
  build: {
    // sorry ivy
    minify: true,
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

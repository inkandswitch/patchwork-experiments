import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { pyodideKernelAssets } from "../native/vite-plugin"

/**
 * Builds the harness into dist/ next to the tool's own chunks, so the tool's
 * `import.meta.url` finds dist/lite and dist/pyfs as it does in Patchwork.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [pyodideKernelAssets(), solid()],
  resolve: {
    alias: [
      // what Patchwork's importmap does
      { find: /^@automerge\/automerge$/, replacement: "@automerge/automerge/slim" },
      { find: /^@automerge\/automerge-repo$/, replacement: "@automerge/automerge-repo/slim" },
    ],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: false,
    target: "es2022",
    assetsDir: "",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        harness: fileURLToPath(new URL("./harness.html", import.meta.url)),
        kernel: fileURLToPath(new URL("./kernel.html", import.meta.url)),
      },
      output: {
        entryFileNames: "harness-[hash].js",
        chunkFileNames: "harness-[name]-[hash].js",
        assetFileNames: "harness-[name]-[hash][extname]",
      },
    },
  },
})

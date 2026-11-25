import external from "@inkandswitch/patchwork-bootloader/externals"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { pyodideKernelAssets } from "./native/vite-plugin"

export default defineConfig({
  base: "./",
  plugins: [pyodideKernelAssets(), solid()],
  build: {
    // dist/lite, dist/native and dist/pyfs are built separately (see package.json)
    emptyOutDir: false,
    target: "es2022",
    // Not library mode, which would inline the Pyodide kernel's worker as a data: URL.
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: {
      // The native editors bundle their own @codemirror/language, so its
      // @lezer copies match the language packages' and highlighting works.
      external: external.filter(id => id !== "@codemirror/language"),
      input: { index: "src/index.ts" },
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        // Chunks sit in dist/ itself: the tools find dist/lite, dist/native
        // and dist/pyfs relative to their own URL.
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
})

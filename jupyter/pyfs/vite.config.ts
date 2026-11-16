import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

/** One self-contained module, since the kernel worker has no importmap; the wasm stays a separate file. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: "../dist/pyfs",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      preserveEntrySignatures: "strict",
      output: { format: "es", entryFileNames: "pyfs.js" },
    },
  },
})

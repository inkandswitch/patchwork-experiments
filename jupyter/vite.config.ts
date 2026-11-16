import { defineConfig } from "vite"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
  build: {
    // dist/lite and dist/pyfs are built separately (see package.json)
    emptyOutDir: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: { external },
  },
})

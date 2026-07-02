import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// No Solid / no CSS here — the host is a plain codemirror extension — so this is
// a bare lib build. CodeMirror is externalized (see the bootloader externals),
// so the host shares the runtime's single codemirror instance with the editor
// and the extensions cards publish.
export default defineConfig({
  base: "./",
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    sourcemap: true,
    minify: false,
    rollupOptions: { external },
  },
});

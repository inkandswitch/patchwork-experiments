import { defineConfig } from "vite";
import external from "@inkandswitch/patchwork-bootloader/externals";

// The entry (src/index.js) is plugin metadata only and is evaluated in a
// worker, so it must stay free of DOM and bare imports. CSS is imported with
// `?inline` and injected by the tool on mount.
//
// The second entry is Fetch data's task (src/fetch-task.js), at
// dist/fetch-task.js in every build: a task names its code by that path, and a
// pool imports it in a run worker, so it too stays free of DOM and bare imports.
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    minify: true,
    sourcemap: false,
    modulePreload: false,
    emptyOutDir: true,
    rollupOptions: {
      external,
      input: { index: "./src/index.js", "fetch-task": "./src/fetch-task.js" },
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

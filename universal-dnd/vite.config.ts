import { defineConfig } from "vite";

// A self-contained tool bundle. It deliberately imports nothing from the
// platform at runtime (only TS `import type`s, which are erased), so the
// output is a single dependency-free ES module that ModuleWatcher can load
// directly. That keeps the prototype trivially movable to its own repo later.
export default defineConfig({
  build: {
    target: "firefox137",
    minify: false,
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: { entryFileNames: "index.js" },
    },
  },
});

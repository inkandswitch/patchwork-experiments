import { defineConfig } from "vitest/config";

const local = new URL("./test/rhino-local.js", import.meta.url).pathname;

export default defineConfig({
  plugins: [
    {
      name: "rhino3dm-from-node_modules",
      enforce: "pre",
      resolveId(id) {
        if (id.startsWith("https://cdn.jsdelivr.net/npm/rhino3dm@")) return local;
      },
    },
  ],
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
    maxWorkers: 2,
    include: ["*.test.js"],
  },
});

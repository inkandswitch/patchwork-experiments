import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // the host provides this through its importmap; the build leaves it external
      "@inkandswitch/patchwork-plugins": fileURLToPath(new URL("./src/test/patchwork-plugins-stub.js", import.meta.url)),
    },
  },
  test: {
    // a test file runs in Node unless its first line asks for a DOM
    // (`// @vitest-environment happy-dom`)
    environment: "node",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js", "daemon/**/*.test.mjs"],
  },
});

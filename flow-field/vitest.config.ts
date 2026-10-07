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
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
  },
});

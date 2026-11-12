import { defineConfig } from "vitest/config";

// Nothing here touches the DOM: node, which has CompressionStream for the PNGs.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
  },
});

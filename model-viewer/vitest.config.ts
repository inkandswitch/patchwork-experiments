import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
    maxWorkers: 2,
    include: ["*.test.js"],
  },
});

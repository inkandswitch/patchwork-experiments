import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node by default, as in a worker; files that need a DOM say so with a
    // `// @vitest-environment happy-dom` pragma, which package_test reads too.
    environment: "node",
    setupFiles: ["./vitest.setup.js"],
    globals: true,
    passWithNoTests: true,
    maxWorkers: 2,
  },
});

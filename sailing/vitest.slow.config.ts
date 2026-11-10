import { defineConfig } from "vitest/config";

// The slow tier: `pnpm test:slow`. Only *.slow.test.js: the long physics
// settles, the full agreement sweep and the multi-second sails.
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.slow.test.js"],
    testTimeout: 120_000,
  },
});

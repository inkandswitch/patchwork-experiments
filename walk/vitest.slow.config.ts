import { defineConfig } from "vitest/config";

// The slow tier: `pnpm test:slow`. Only *.slow.test.js: the walker's enumerated cases.
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.slow.test.js"],
    testTimeout: 120_000,
  },
});

import { defineConfig } from "vitest/config";

// One tier: the walker's enumerated cases (walker.cases, walker.supports) run
// with the rest, so `pnpm test` (and CI) runs every table.
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
    testTimeout: 120_000,
  },
});

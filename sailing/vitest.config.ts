import { defineConfig } from "vitest/config";

// The fast tier: `pnpm test`. The long physics settles, the full agreement
// sweep and the multi-second sails live in *.slow.test.js: `pnpm test:slow`
// (vitest.slow.config.ts).
export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
    exclude: ["src/**/*.slow.test.js", "**/node_modules/**"],
  },
});

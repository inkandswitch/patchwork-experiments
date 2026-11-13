// The integration bench (bench/integration.test.js): minutes, not seconds,
// so it is kept out of `pnpm test` and run by `pnpm bench:integration`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["bench/**/*.test.js"],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});

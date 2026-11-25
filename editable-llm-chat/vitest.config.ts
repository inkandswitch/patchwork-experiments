import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.{js,ts}"],
    testTimeout: 30_000,
  },
});

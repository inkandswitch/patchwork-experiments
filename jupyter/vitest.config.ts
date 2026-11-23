import { defineConfig } from "vitest/config"

// The root package's tests (shared/ and native/); lab/extension has its own.
export default defineConfig({
  test: { include: ["test/**/*.spec.ts"], environment: "node" },
})

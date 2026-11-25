import { defineConfig } from "vitest/config"
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [solid()],
  test: { include: ["test/**/*.spec.ts"], environment: "node", passWithNoTests: true, maxWorkers: 2 },
})

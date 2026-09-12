import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    // the tool links its own stylesheet; happy-dom shouldn't go fetching it
    environmentOptions: {
      happyDOM: { settings: { disableCSSFileLoading: true } },
    },
  },
});

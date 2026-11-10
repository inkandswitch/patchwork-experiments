import { defineConfig } from "vitest/config";

export default defineConfig({
  // the host's filesystem package (importPackage) isn't installed here: the
  // stage reaches it by dynamic import, through the importmap
  resolve: { alias: { "@inkandswitch/patchwork-filesystem": new URL("./src/test/filesystem-mock.js", import.meta.url).pathname } },
  test: {
    environment: "happy-dom",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
  },
});

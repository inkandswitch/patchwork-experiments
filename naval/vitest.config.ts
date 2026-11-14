import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // the host provides this through its importmap; the build leaves it external
      "@inkandswitch/patchwork-plugins": fileURLToPath(new URL("./src/test/patchwork-plugins-stub.js", import.meta.url)),
      "@inkandswitch/patchwork-filesystem": fileURLToPath(new URL("./src/test/patchwork-filesystem-stub.js", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    // Node 26 defines a global localStorage of its own (undefined without
    // --localstorage-file) that shadows happy-dom's; turned off here, the
    // tests read happy-dom's on any Node (a no-op on Node 24)
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] }, threads: { execArgv: ["--no-experimental-webstorage"] } },
    globals: true,
    passWithNoTests: true,
    // the hull and statics tests build real meshes; a loaded machine can take a while
    testTimeout: 30_000,
    include: ["src/**/*.test.js"],
  },
});

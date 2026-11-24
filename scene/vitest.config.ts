import { defineConfig } from "vitest/config";

export default defineConfig({
  // the host's filesystem package (importPackage) isn't installed here: the
  // stage reaches it by dynamic import, through the importmap
  resolve: { alias: { "@inkandswitch/patchwork-filesystem": new URL("./src/test/filesystem-mock.js", import.meta.url).pathname } },
  test: {
    environment: "happy-dom",
    // Node 26 defines a global localStorage of its own (undefined without
    // --localstorage-file) that shadows happy-dom's; turned off here, the
    // tests read happy-dom's on any Node (a no-op on Node 24)
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] }, threads: { execArgv: ["--no-experimental-webstorage"] } },
    globals: true,
    setupFiles: ["src/test/setup.js"],
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
  },
});

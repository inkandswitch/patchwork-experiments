import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
    include: ["src/**/*.test.js"],
    // Long, finite tests; a timeout only guards against a hang, and 5 s is
    // less than some take on a loaded machine.
    testTimeout: 60_000,
    // Real-thread work finishes at once, so only virtual time decides when;
    // and a real event-loop turn after each test (see the file).
    setupFiles: ["src/test-setup.js"],
    // Virtual time includes performance.now: the host's step budget and
    // automerge-repo's cooperative yields read it, and on real time how far
    // a frame got, or when a document was processed, would follow the load.
    fakeTimers: {
      toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "Date", "performance"],
    },
  },
});

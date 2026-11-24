import { defineConfig } from "vitest/config";

// Test files that touch no DOM (pure modules, Automerge, CSS read as text):
// they run in Node's own environment and don't pay for a happy-dom window.
// Every other test file gets one.
const NO_DOM = [
  "src/anchors.test.js",
  "src/carry-rules.test.js",
  "src/datatype.test.js",
  "src/deps.test.js",
  "src/dnd.test.js",
  "src/embed-css.test.js",
  "src/extract.test.js",
  "src/frame-home.test.js",
  "src/glb-queue.test.js",
  "src/glb.test.js",
  "src/gltf-content.test.js",
  "src/groups.test.js",
  "src/hierarchy.test.js",
  "src/layers.test.js",
  "src/linearity.test.js",
  "src/ops.test.js",
  "src/packages.test.js",
  "src/pick-accel.test.js",
  "src/providers.test.js",
  "src/render-manager-announce.test.js",
  "src/render-read.test.js",
  "src/selection.test.js",
  "src/snap.test.js",
  "src/stacking.test.js",
  "src/staleness.test.js",
  "src/stl.test.js",
  "src/surface.test.js",
  "src/theme.test.js",
  "src/touch-keys.test.js",
  "src/transfer.test.js",
  "src/tree-drop.test.js",
  "src/undo.test.js",
  "src/units.test.js",
  "src/native/audience.test.js",
  "src/native/clock.test.js",
  "src/native/gears.test.js",
  "src/native/holds.test.js",
  "src/native/link-graph.test.js",
  "src/native/links.test.js",
  "src/native/smooth.test.js",
  "src/native/telling.test.js",
  "src/native/veil.test.js",
  "src/native/xray-model.test.js",
  "src/parts/carry-math.test.js",
  "src/parts/landed-pose.test.js",
  "src/parts/landing.test.js",
  "src/parts/packages.test.js",
  "src/parts/parts-place.test.js",
  "src/test/empty-scene.test.js",
  "src/stage/ambients.test.js",
  "src/stage/announce.test.js",
  "src/stage/host.test.js",
  "src/stage/ladder.test.js",
  "src/stage/pointer.test.js",
  "src/stage/presence.test.js",
  "src/stage/ride.test.js",
  "src/stage/scope.test.js",
  "src/stage/stage-pure.test.js",
];

export default defineConfig({
  // the host's filesystem package (importPackage) isn't installed here: the
  // stage reaches it by dynamic import, through the importmap
  resolve: { alias: { "@inkandswitch/patchwork-filesystem": new URL("./src/test/filesystem-mock.js", import.meta.url).pathname } },
  test: {
    // Node 26 defines a global localStorage of its own (undefined without
    // --localstorage-file) that shadows happy-dom's; turned off here, the
    // tests read happy-dom's on any Node (a no-op on Node 24)
    poolOptions: { forks: { execArgv: ["--no-experimental-webstorage"] }, threads: { execArgv: ["--no-experimental-webstorage"] } },
    globals: true,
    setupFiles: ["src/test/setup.js"],
    passWithNoTests: true,
    projects: [
      { extends: true, test: { name: "dom", environment: "happy-dom", include: ["src/**/*.test.js"], exclude: NO_DOM } },
      { extends: true, test: { name: "node", environment: "node", include: NO_DOM } },
    ],
  },
});

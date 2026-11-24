// @vitest-environment happy-dom
// Arriving waits for the content a doc shows (stage.js contentIn, read by
// view.js before a start or an arrival settles): every visible object with
// something to load. An object with nothing to load (its shape its traits'
// data) is in at once, so a doc holding one arrives without waiting out
// ARRIVE_WAIT_MS.
//
// The harness has no WebGL, and without it contentIn is true by rule; these
// cases say the viewport works for the one read, then put it back.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";

let s = null;
afterEach(() => {
  s?.unmount?.();
  s = null;
});

/** The outermost stage's contentIn(), as if the viewport worked. */
function contentIn() {
  const vp = s.debug.viewport;
  const was = vp.ok;
  vp.ok = true;
  try {
    return s.debug.view.outermost().contentIn();
  } finally {
    vp.ok = was;
  }
}

const FILE = "file:"; // (replaced by the repo's file doc)

// every kind of visible object, one per doc: [label, object, in at once?]
const CASES = [
  ["nothing at all", null, true],
  ["an object with no source and no render (its shape is a trait's data)", object({ sourceUrl: null, providerId: null, renderUrl: null, traits: { "t.box": { size: [1, 1, 1] } } }), true],
  ["the same, hidden", object({ sourceUrl: null, providerId: null, renderUrl: null, visible: false }), true],
  ["a group", { kind: "group", name: "G", parent: null, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }, true],
  ["a file not loaded yet", object({ sourceUrl: FILE, providerId: "file-glb" }), false],
  ["a hidden file not loaded", object({ sourceUrl: FILE, providerId: "file-glb", visible: false }), true],
];

describe("contentIn: what arriving waits for", () => {
  for (const [label, o, want] of CASES)
    it(`${label}: ${want ? "in at once" : "waits"}`, async () => {
      // the file is there to load (the harness's repo has it), and nothing here loads it without WebGL
      const repo = new FakeRepo();
      const file = repo.add({ "@patchwork": { type: "file" }, name: "a.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array(4) });
      const doc = o ? { objects: { a: o.sourceUrl === FILE ? { ...o, sourceUrl: file.url } : o }, order: ["a"] } : {};
      s = await mountStage({ repo, doc });
      expect(contentIn()).toBe(want);
    });
});

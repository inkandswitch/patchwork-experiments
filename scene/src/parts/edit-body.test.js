// The editor is a body (TOOLS.md §3, §4, Decisions 6): its chrome shows in
// Edit and nowhere else. Every body (the stage's Look and Edit; a walk and a
// seat over Look; a station over a walk) × what's selected (nothing, an
// object, a ref) × whether the scene may be written: the real parts, mounted
// together, say whether the halo's handles, the build-param knobs, the
// inspector (opening on the selection), the grid, axes and bounds, and the
// toolbar show. Finite and exhaustive: 5 × 3 × 2 = 30 cases.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { Box3, Vector3 } from "three";
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { getRegistry } from "../test/plugins-mock.js";
import halo from "./halo.js";
import handles from "./handles.js";
import inspector from "./inspector.js";
import grid from "./grid.js";
import axes from "./axes.js";
import bounds from "./bounds.js";
import toolbar from "./toolbar.js";
import select from "./select.js";

const SLICE = {
  type: "scene:source",
  id: "slice-test",
  content: "built",
  name: "Slice",
  supportedDatatypes: ["slicey"],
  params: [{ key: "height", label: "Height", kind: "number", default: 0.2, min: -1, max: 1, step: 0.1, cost: "cheap" }],
  handles: [{ param: "height", axis: [0, 1, 0] }],
  load: async () => ({ build: async () => null }),
};

const BODIES = {
  meta: { id: "t.bodies" },
  module: {
    create: () => ({
      bodies: [
        { id: "walk", label: "Walk", reach: 2, enter: () => ({ input: {}, leave() {} }) },
        { id: "seat", label: "Seat", reach: 2, here: false, enter: () => ({ input: {}, leave() {} }) },
        { id: "station", label: "Station", reach: 2.5, here: false, enter: () => ({ input: {}, leave() {} }) },
      ],
    }),
  },
};

const PARTS = [
  ["scene.toolbar", toolbar],
  ["scene.inspector", inspector],
  ["scene.handles", handles],
  ["scene.halo", halo],
  ["scene.select", select],
  ["scene.grid", grid],
  ["scene.axes", axes],
  ["scene.bounds", bounds],
].map(([id, module]) => ({ meta: { id }, module }));

// No WebGL in happy-dom: "a" has content, a 2 m cube at the origin.
function stubViewport(s) {
  const vp = s.debug.viewport;
  vp.contentOf = (id) => (id === "a" ? { loaded: true, box: { min: [-1, -1, -1], max: [1, 1, 1] }, extras: null, stats: null, root: null } : null);
  vp.objectBox = (id) => (id === "a" ? new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)) : null);
  vp.project = (p) => ({ x: 100 + p[0] * 10, y: 100 - p[1] * 10, visible: true });
  vp.ray = (x, y) => ({ origin: [(x - 100) / 10, (100 - y) / 10, 10], dir: [0, 0, -1] });
}

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

async function mount({ writable }) {
  const repo = new FakeRepo();
  const render = repo.add({ params: { height: 0.2 } });
  s = await mountStage({
    repo,
    extensions: [...PARTS, BODIES],
    doc: {
      objects: { a: object({ name: "Slice", providerId: "slice-test", renderUrl: render.url }) },
      order: ["a"],
      dimensions: { d1: { a: { world: [0, 0, 0] }, b: { world: [1, 0, 0] }, label: null } },
      view: { grid: true, axes: true, bounds: true },
    },
  });
  getRegistry("scene:source").register(SLICE);
  stubViewport(s);
  if (!writable) s.handle.isReadOnly = () => true;
  return s;
}

// How to be in each body: what's entered, in order (the stage's first).
const IN = { look: ["look"], edit: ["edit"], walk: ["look", "walk"], seat: ["look", "seat"], station: ["look", "walk", "station"] };
const SELECTIONS = [null, "a", "dimension:d1"];

const drawnIn = (id) => [...(s.debug.viewport.layers.get(id) ?? [])].reduce((n, g) => n + g.children.length, 0) > 0;

/** What shows now. */
function chrome() {
  return {
    handles: s.instance("scene.halo").debug.target != null,
    knobs: s.port.querySelectorAll(".handle-label").length > 0,
    inspector: s.instance("scene.inspector").tab.isOpen(),
    grid: drawnIn("scene.grid"),
    axes: drawnIn("scene.axes"),
    bounds: drawnIn("scene.bounds") || s.port.querySelectorAll(".bounds-label").length > 0, // (a selected object gets sizes, not a box)
    toolbar: !s.root.querySelector('.stage-edge-part[data-owner="scene.toolbar"]').hidden,
  };
}

/** What should show: only in Edit; handles and knobs on an object where the scene may be written; the inspector on an object. */
function expected(body, selected, writable) {
  const edit = body === "edit";
  const obj = selected === "a";
  return { handles: edit && obj && writable, knobs: edit && obj && writable, inspector: edit && obj, grid: edit, axes: edit, bounds: edit, toolbar: edit };
}

describe("the editor is the Edit body", () => {
  it("every body × nothing, an object or a ref selected × writable or not: handles, knobs, inspector, grid, axes, bounds, toolbar", async () => {
    let cases = 0;
    for (const writable of [true, false]) {
      await mount({ writable });
      const api = s.api("t.bodies");
      for (const [body, path] of Object.entries(IN)) {
        for (const selected of SELECTIONS) {
          // start each case from Look with nothing selected
          api.body.enter("look");
          s.local.swap((m) => ({ ...m, selected: null }));
          await settle();
          for (const id of path) expect(api.body.enter(id)).toBe(true);
          s.local.swap((m) => ({ ...m, selected }));
          await settle();
          await settle();
          expect(s.local.get().body.id).toBe(body);
          expect({ body, selected, writable, ...chrome() }).toEqual({ body, selected, writable, ...expected(body, selected, writable) });
          cases++;
        }
      }
      s.unmount();
      s = null;
    }
    expect(cases).toBe(5 * 3 * 2);
  }, 60_000);

  it("leaving Edit takes its chrome with it: the inspector shuts, a held Measure is put down; coming back, the selection's inspector opens again", async () => {
    const { default: measure } = await import("./measure.js");
    PARTS.push({ meta: { id: "scene.measure" }, module: measure });
    try {
      await mount({ writable: true });
      const api = s.api("t.bodies");
      expect(s.local.get().body.id).toBe("edit"); // a scene made new
      s.local.swap((m) => ({ ...m, selected: "a" }));
      await settle();
      expect(chrome().inspector).toBe(true);
      expect(api.run({ ext: "scene.measure", command: "measure" })).toBe(true);
      expect(s.local.get().held?.command).toBe("measure");
      api.body.enter("walk");
      await settle();
      expect(s.local.get().body.id).toBe("walk");
      expect(s.local.get().held).toBe(null);
      expect(chrome().inspector).toBe(false);
      // Measure isn't on offer outside Edit: not run, not on a key
      expect(api.run({ ext: "scene.measure", command: "measure" })).toBe(false);
      // the selection is still there (yours, in every body); Edit shows its chrome again
      expect(s.local.get().selected).toBe("a");
      api.body.enter("edit");
      await settle();
      expect(chrome()).toMatchObject({ inspector: true, handles: true, toolbar: true });
    } finally {
      PARTS.pop();
    }
  }, 30_000);
});

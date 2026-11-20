// The editor is a hand (STAGE.md, "Hands"; HISTORY.md, Kernel step 1): its chrome shows while the Edit
// hand is held and never otherwise, whatever the body. Every body (the
// stage's Look; a walk and a seat over Look; a station over a walk) × holding
// the editor or not × what's selected (nothing, an object, a ref) × whether
// the scene may be written × Move held or not (it is the editor's, so only
// on offer while editing): the real parts, mounted together, say whether the
// halo's handles, the build-param knobs, the inspector (opening a beat after
// the selection), the grid, axes and bounds, and the toolbar show. Finite and
// exhaustive: 4 × 2 × 3 × 2 × 2 = 96 cases.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { Box3, Vector3 } from "three";
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { getRegistry } from "../test/plugins-mock.js";
import { manualTime } from "../stage/time.js";
import halo from "./halo.js";
import handles from "./handles.js";
import inspector from "./inspector.js";
import grid from "./grid.js";
import axes from "./axes.js";
import bounds from "./bounds.js";
import toolbar from "./toolbar.js";
import select from "./select.js";
import { editing } from "../stage/bodies.js";

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
// the stage's time, stepped
let time = null;
/** A frame that takes no time: the stage's flushes and frame callbacks run. */
async function still() {
  await time.step(1, { still: true });
  await settle();
}
afterEach(() => {
  s?.unmount();
  s = null;
});

async function mount({ writable }) {
  const repo = new FakeRepo();
  const render = repo.add({ params: { height: 0.2 } });
  time = manualTime();
  s = await mountStage({
    repo,
    time,
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
const IN = { look: ["look"], walk: ["look", "walk"], seat: ["look", "seat"], station: ["look", "walk", "station"] };
const SELECTIONS = [null, "a", "dimension:d1"];

/** What this view last told peers it is in and holding (presence: STAGE.md, "Hands"), past presence's rate. */
const told = async () => {
  await time.step(30);
  await settle();
  const p = s.handle.broadcasts.filter((m) => m.type === "scene:presence" && !m.bye).at(-1);
  return { body: p?.body?.label ?? null, held: (p?.held ?? []).map((h) => h.name) };
};

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

/** What should show: only holding the editor; handles and knobs with Move held, on an object where the scene may be written; the inspector on an object. */
function expected(edit, move, selected, writable) {
  const obj = selected === "a";
  return { handles: edit && move && obj && writable, knobs: edit && move && obj && writable, inspector: edit && obj, grid: edit, axes: edit, bounds: edit, toolbar: edit };
}
/** Pick up Move (V) → whether it ran: it is the editor's, so not without it. */
const move = () => s.api("scene.halo").run({ ext: "scene.halo", command: "move" });

// H13: editing ⇔ the Edit hand is held; its chrome shows exactly then, in any body
describe("the editor is the Edit hand", () => {
  it("every body × editing or not × nothing, an object or a ref selected × writable or not × Move or not: handles, knobs, inspector, grid, axes, bounds, toolbar", async () => {
    let cases = 0;
    for (const writable of [true, false]) {
      await mount({ writable });
      const api = s.api("t.bodies");
      for (const [body, path] of Object.entries(IN)) {
        for (const edit of [false, true]) {
          for (const selected of SELECTIONS) {
            for (const moving of [false, true]) {
              // start each case from Look, not editing (so holding nothing), with nothing selected
              api.body.enter("look");
              s.edit(false);
              await settle();
              for (const id of path) expect(api.body.enter(id)).toBe(true);
              s.edit(edit);
              if (moving) expect(move()).toBe(edit);
              s.local.swap((m) => ({ ...m, selected }));
              await still();
              expect([s.local.get().body.id, editing(s.local.get()), s.local.get().held.map((t) => t.command)]).toEqual([body, edit, moving && edit ? ["move"] : []]);
              expect({ body, edit, moving, selected, writable, ...chrome() }).toEqual({ body, edit, moving, selected, writable, ...expected(edit, moving, selected, writable) });
              cases++;
            }
          }
        }
      }
      s.unmount();
      s = null;
    }
    expect(cases).toBe(4 * 2 * 3 * 2 * 2);
  }, 60_000);

  it("a body doesn't touch the editor: walking, a held Measure, the selection and the inspector stay; Leave never puts the editor down; peers are told every hand, top last, an open menu passed over", async () => {
    const { default: measure } = await import("./measure.js");
    PARTS.push({ meta: { id: "scene.measure" }, module: measure });
    try {
      await mount({ writable: true });
      const api = s.api("t.bodies");
      expect(editing(s.local.get())).toBe(true); // a scene made new
      s.local.swap((m) => ({ ...m, selected: "a" }));
      await still();
      expect(s.api("scene.measure").run({ ext: "scene.measure", command: "measure" })).toBe(true);
      api.body.enter("walk");
      await still();
      expect([s.local.get().body.id, editing(s.local.get()), s.local.get().held.map((t) => t.command), s.local.get().selected, chrome().inspector]).toEqual(["walk", true, ["measure"], "a", true]);
      // Measure sits over Edit: peers see both, top last
      expect(s.local.get().hands.map((h) => h.name)).toEqual(["Edit", "Measure"]);
      expect(await told()).toEqual({ body: "Walk", held: ["Edit", "Measure"] });
      api.body.leave();
      await still();
      expect([s.local.get().body.id, editing(s.local.get()), s.local.get().held.map((t) => t.command)]).toEqual(["look", true, ["measure"]]);
      // Measure put down, Edit is what peers see; an open menu over it is nobody else's business
      s.api("scene.measure").run({ ext: "scene.measure", command: "measure", value: false });
      const close = api.popover(() => close());
      await still();
      expect([s.local.get().hands.map((h) => h.kind), await told()]).toEqual([["edit", "popover"], { body: "Look", held: ["Edit"] }]);
      close();
      s.edit(false);
      await still();
      expect(await told()).toEqual({ body: "Look", held: [] });
    } finally {
      PARTS.pop();
    }
  }, 30_000);

  it("putting the editor down takes what it holds with it: the inspector shuts, a held Measure (wherever it is in the hands) and the selection are put down, a tool that isn't the editor's stays; picking it up again and selecting, the inspector opens again", async () => {
    const { default: measure } = await import("./measure.js");
    PARTS.push({ meta: { id: "scene.measure" }, module: measure });
    try {
      await mount({ writable: true });
      const api = s.api("t.bodies");
      expect(editing(s.local.get())).toBe(true); // a scene made new
      s.local.swap((m) => ({ ...m, selected: "a" }));
      await still();
      expect(chrome().inspector).toBe(true);
      expect(move()).toBe(true);
      expect(s.api("scene.measure").run({ ext: "scene.measure", command: "measure" })).toBe(true);
      // a tool not the editor's, over Measure
      const putWrench = api.hold({ name: "Wrench" }, {});
      expect(s.local.get().held.map((t) => t.name)).toEqual(["Move", "Measure", "Wrench"]);
      s.edit(false);
      await still();
      expect(editing(s.local.get())).toBe(false);
      expect(s.local.get().held.map((t) => t.name)).toEqual(["Wrench"]);
      putWrench();
      expect(chrome().inspector).toBe(false);
      // Measure isn't on offer while not editing: not run, not on a key
      expect(s.api("scene.measure").run({ ext: "scene.measure", command: "measure" })).toBe(false);
      // the selection went with the editor (attention is the selection: F would act on what was last edited)
      expect(s.local.get().selected).toBe(null);
      s.edit(true);
      await still();
      expect(chrome()).toMatchObject({ inspector: false, handles: false, toolbar: true });
      s.local.swap((m) => ({ ...m, selected: "a" }));
      await still();
      // selecting is only selecting: the handles are Move's
      expect(chrome()).toMatchObject({ inspector: true, handles: false, toolbar: true });
      expect(move()).toBe(true);
      await still();
      expect(chrome()).toMatchObject({ inspector: true, handles: true, toolbar: true });
    } finally {
      PARTS.pop();
    }
  }, 30_000);
});

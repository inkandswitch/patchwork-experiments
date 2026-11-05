import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { Box3, Vector3 } from "three";
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import { getRegistry } from "../test/plugins-mock.js";
import handles, { effectiveTool, handleLine, handlePlacement, dragValue, providerOf, GRAB_PX } from "./handles.js";

const SLICE = {
  type: "scene:source",
  id: "slice-test",
  name: "Slice",
  supportedDatatypes: ["slicey"],
  params: [{ key: "height", label: "Height", kind: "number", default: 0.2, min: -1, max: 1, step: 0.1, cost: "cheap" }],
  handles: [{ param: "height", axis: [0, 1, 0] }],
  load: async () => ({ build: async () => null }),
};

// A selection stand-in: local.selected, and a click on nothing deselects.
const clicks = [];
const fakeSelect = {
  meta: { id: "t.select" },
  module: { create: (api) => ({ input: { click: (ev) => (clicks.push(ev.x), api.local.swap((l) => ({ ...l, selected: null })), true) } }) },
};
const fakeArm = { meta: { id: "t.arm" }, module: { create: () => ({}) } };

// No WebGL in happy-dom: give the viewport an object "a" with content (a 2 m
// cube at the origin, in a 10 px/m orthographic view centred on (100, 100),
// looking down -z).
function stubViewport(s, { loaded = true } = {}) {
  const vp = s.debug.viewport;
  vp.contentOf = (id) => (id === "a" ? { loaded, box: { min: [-1, -1, -1], max: [1, 1, 1] }, extras: null, stats: null, root: null } : null);
  vp.objectBox = (id) => (id === "a" ? new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)) : null);
  vp.project = (p) => ({ x: 100 + p[0] * 10, y: 100 - p[1] * 10, visible: true });
  vp.ray = (x, y) => ({ origin: [(x - 100) / 10, (100 - y) / 10, 10], dir: [0, 0, -1] });
}

async function setup({ view = {}, params = { height: 0.2 } } = {}) {
  clicks.length = 0;
  const repo = new FakeRepo();
  const render = repo.add({ params });
  const s = await mountStage({
    repo,
    extensions: [fakeSelect, { meta: { id: "scene.handles", name: "Handles" }, module: handles }, fakeArm],
    kits: [{ id: "model", extensions: ["t.select", "scene.handles", "t.arm"] }],
    doc: { objects: { a: object({ name: "Slice", providerId: "slice-test", renderUrl: render.url }), g: object({ kind: "group", providerId: null }) }, view },
  });
  getRegistry("scene:source").register(SLICE);
  stubViewport(s);
  return { s, render };
}

const select = async (s, id) => {
  s.local.swap((l) => ({ ...l, selected: id }));
  await settle();
};
const labelTexts = (s) => [...s.port.querySelectorAll(".handle-label")].map((el) => el.textContent);
const layerMeshes = (s) => {
  const out = [];
  for (const g of s.debug.viewport.layers.get("scene.handles") ?? []) g.traverse((o) => o.isMesh && out.push(o));
  return out;
};

let current = null;
afterEach(() => {
  current?.unmount();
  current = null;
});

describe("scene.handles: pure helpers", () => {
  it("reads the effective tool, the doc's suggestion under the viewer's choice", () => {
    expect(effectiveTool({}, {})).toBe("move");
    expect(effectiveTool({}, { view: { defaultGizmo: "translate" } })).toBe("move");
    expect(effectiveTool({}, { view: { defaultGizmo: "hand" } })).toBe("hand");
    expect(effectiveTool({}, { view: { defaultMode: "rotate", defaultGizmo: "hand" } })).toBe("rotate");
    expect(effectiveTool({ tool: "hand" }, { view: { tool: "move" } })).toBe("hand");
  });
  it("finds the provider by id", () => {
    const reg = { filter: (fn) => [SLICE, { id: "x" }].filter(fn) };
    expect(providerOf(reg, "slice-test")).toBe(SLICE);
    expect(providerOf(reg, "nope")).toBe(null);
    expect(providerOf(null, "slice-test")).toBe(null);
  });
  it("puts the line through the middle of the geometry, in the world, scaled", () => {
    const spec = { axis: [0, 1, 0], min: -1, max: 1 };
    // moved to (5, 0, 0), scaled 2; its box is off-centre in x
    const m = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1];
    const line = handleLine(spec, m, { min: [0, -1, -1], max: [2, 1, 1] });
    expect(line.base).toEqual([7, 0, 0]);
    expect(line.unit).toEqual([0, 2, 0]);
    expect(line.size).toBeCloseTo(Math.hypot(2, 2, 2) * 2);
    const { at, track, radius } = handlePlacement(spec, line, 0.5);
    expect(at).toEqual([7, 1, 0]);
    expect(track[0][1]).toBeCloseTo(-2); // held to the param's range
    expect(track[1][1]).toBeCloseTo(2);
    expect(radius).toBeCloseTo(line.size * 0.015);
    expect(handleLine(spec, null, { min: [0, 0, 0], max: [1, 1, 1] })).toBe(null);
  });
  it("drags to the ray's closest point on the line, clamped and stepped", () => {
    const spec = { axis: [0, 1, 0], min: -1, max: 1, step: 0.1, integer: false };
    const line = { base: [0, 0, 0], unit: [0, 1, 0], size: 1 };
    expect(dragValue(spec, line, { origin: [0, 0.43, 10], dir: [0, 0, -1] })).toBe(0.4);
    expect(dragValue(spec, line, { origin: [0, 7, 10], dir: [0, 0, -1] })).toBe(1);
    expect(dragValue(spec, line, { origin: [0, 0, 0], dir: [0, 1, 0] })).toBe(null); // along the line
    expect(dragValue(spec, line, null)).toBe(null);
  });
});

describe("scene.handles on the stage", () => {
  it("shows the selected object's handles at its render doc's values, and none for nothing selected", async () => {
    const { s, render } = await setup();
    current = s;
    const inst = s.instance("scene.handles");
    expect(inst.handles()).toEqual([]);
    const before = render.listenerCount("change");
    await select(s, "a");
    expect(inst.handles()).toEqual([{ key: "height", label: "Height", axis: [0, 1, 0], value: 0.2, min: -1, max: 1, step: 0.1, integer: false }]);
    expect(labelTexts(s)).toEqual(["Height: 0.2"]);
    expect(layerMeshes(s)).toHaveLength(1);
    expect(render.listenerCount("change")).toBe(before + 1);
    // the render doc changes (a peer, the inspector): the knob follows
    render.change((d) => (d.params.height = -0.5));
    expect(inst.handles()[0].value).toBe(-0.5);
    expect(labelTexts(s)).toEqual(["Height: -0.5"]);
    await select(s, null);
    expect(inst.handles()).toEqual([]);
    expect(labelTexts(s)).toEqual([]);
    expect(layerMeshes(s)).toHaveLength(0);
    expect(render.listenerCount("change")).toBe(before);
    // a group has none
    await select(s, "g");
    expect(labelTexts(s)).toEqual([]);
    // nor a ref (a selected dimension)
    await select(s, "dimension:d1");
    expect(inst.handles()).toEqual([]);
    expect(labelTexts(s)).toEqual([]);
  });

  it("draws nothing before the object's content arrives", async () => {
    const { s } = await setup();
    current = s;
    stubViewport(s, { loaded: false });
    await select(s, "a");
    expect(s.instance("scene.handles").handles()).toHaveLength(1);
    expect(labelTexts(s)).toEqual([]);
    stubViewport(s);
    s.local.swap((l) => ({ ...l, status: { a: { state: "ready" } } })); // what content arriving looks like to update()
    await settle();
    expect(labelTexts(s)).toEqual(["Height: 0.2"]);
  });

  it("stands down for the hand and while anything is armed", async () => {
    const { s } = await setup();
    current = s;
    await select(s, "a");
    expect(labelTexts(s)).toHaveLength(1);
    s.local.swap((l) => ({ ...l, tool: "hand" }));
    await settle();
    expect(labelTexts(s)).toEqual([]);
    expect(s.instance("scene.handles").input.widgetAt({ x: 100, y: 98 })).toBe(null);
    s.local.swap((l) => ({ ...l, tool: "move" }));
    await settle();
    expect(labelTexts(s)).toHaveLength(1);
    const disarm = s.api("t.arm").arm({});
    await settle();
    expect(s.local.get().armed).toBe("t.arm");
    expect(labelTexts(s)).toEqual([]);
    disarm();
    await settle();
    expect(labelTexts(s)).toHaveLength(1);
  });

  it("the doc's suggested tool counts too", async () => {
    const { s } = await setup({ view: { defaultGizmo: "hand" } });
    current = s;
    await select(s, "a");
    expect(labelTexts(s)).toEqual([]);
    s.local.swap((l) => ({ ...l, tool: "rotate" }));
    await settle();
    expect(labelTexts(s)).toHaveLength(1);
  });

  it("a knob within reach of the pointer is its widget, on top", async () => {
    const { s } = await setup();
    current = s;
    await select(s, "a");
    const input = s.instance("scene.handles").input;
    // the knob is at (0, 0.2, 0): port (100, 98)
    expect(input.widgetAt({ x: 100, y: 98 })).toEqual({ onTop: true, key: "height" });
    expect(input.widgetAt({ x: 100 + GRAB_PX - 1, y: 98 })).toEqual({ onTop: true, key: "height" });
    expect(input.widgetAt({ x: 100 + GRAB_PX + 1, y: 98 })).toBe(null);
  });

  it("dragging a knob moves it along its axis, and letting go writes the param to the render doc", async () => {
    const { s, render } = await setup();
    current = s;
    await select(s, "a");
    s.pointer("pointerdown", 100, 98);
    s.pointer("pointermove", 100, 93); // 0.7 up
    expect(labelTexts(s)).toEqual(["Height: 0.7"]);
    expect(render.doc().params.height).toBe(0.2); // nothing written mid-drag
    s.pointer("pointermove", 100, 0); // past the top: held to max
    expect(labelTexts(s)).toEqual(["Height: 1"]);
    s.pointer("pointermove", 100, 93);
    s.pointer("pointerup", 100, 93);
    await settle();
    expect(render.doc().params.height).toBe(0.7);
    expect(s.instance("scene.handles").handles()[0].value).toBe(0.7);
    expect(labelTexts(s)).toEqual(["Height: 0.7"]);
    expect(clicks).toEqual([]); // the press was the knob's
    expect(s.local.get().selected).toBe("a");
  });

  it("a tap on a knob is consumed: no click, so nothing deselects", async () => {
    const { s } = await setup();
    current = s;
    await select(s, "a");
    s.click(100, 98);
    await settle();
    expect(clicks).toEqual([]);
    expect(s.local.get().selected).toBe("a");
    // elsewhere it's an ordinary click
    s.click(30, 30);
    await settle();
    expect(clicks).toEqual([30]);
    expect(s.local.get().selected).toBe(null);
  });

  it("a cancelled drag writes nothing and puts the knob back", async () => {
    const { s, render } = await setup();
    current = s;
    await select(s, "a");
    s.pointer("pointerdown", 100, 98);
    s.pointer("pointermove", 100, 90);
    expect(labelTexts(s)).toEqual(["Height: 1"]);
    s.pointer("pointercancel", 100, 90);
    await settle();
    expect(render.doc().params.height).toBe(0.2);
    expect(labelTexts(s)).toEqual(["Height: 0.2"]);
  });

  it("shows the value let go of until the render doc echoes it, without touching shared specs", async () => {
    const { s, render } = await setup();
    current = s;
    await select(s, "a");
    // hold the render doc's change events back, as a slow repo would
    const queued = [];
    const emit = render.emit.bind(render);
    render.emit = (ev, p) => queued.push(() => emit(ev, p));
    s.pointer("pointerdown", 100, 98);
    s.pointer("pointermove", 100, 93);
    s.pointer("pointermove", 100, 95);
    s.pointer("pointerup", 100, 95);
    await settle();
    expect(render.doc().params.height).toBe(0.5);
    expect(labelTexts(s)).toEqual(["Height: 0.5"]);
    expect(s.instance("scene.handles").handles()[0].value).toBe(0.5);
    render.emit = emit;
    for (const f of queued) f();
    expect(labelTexts(s)).toEqual(["Height: 0.5"]);
    // and later changes from elsewhere still show
    render.change((d) => (d.params.height = -0.3));
    expect(labelTexts(s)).toEqual(["Height: -0.3"]);
  });

  it("a provider registered after the object is selected shows up on the next update", async () => {
    const repo = new FakeRepo();
    const render = repo.add({ params: { height: 0.2 } });
    const s = await mountStage({
      repo,
      extensions: [{ meta: { id: "scene.handles" }, module: handles }],
      kits: [{ id: "model", extensions: ["scene.handles"] }],
      doc: { objects: { a: object({ providerId: "slice-later", renderUrl: render.url }) } },
    });
    current = s;
    stubViewport(s);
    await select(s, "a");
    expect(labelTexts(s)).toEqual([]);
    getRegistry("scene:source").register({ ...SLICE, id: "slice-later" });
    s.change((d) => (d.objects.a.name = "renamed"));
    await settle();
    expect(labelTexts(s)).toEqual(["Height: 0.2"]);
  });

  it("lets go of the render doc when it stops", async () => {
    const { s, render } = await setup();
    current = s;
    const before = render.listenerCount("change");
    await select(s, "a");
    expect(render.listenerCount("change")).toBe(before + 1);
    s.local.swap((l) => ({ ...l, kits: { on: [], off: ["model"] } }));
    await settle();
    expect(s.instance("scene.handles")).toBeFalsy();
    expect(render.listenerCount("change")).toBe(before);
    expect(labelTexts(s)).toEqual([]);
  });
});

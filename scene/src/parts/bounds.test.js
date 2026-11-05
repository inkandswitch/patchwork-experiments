import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import bounds, { boundsTargets, sizeLabels } from "./bounds.js";

const BOXES = { a: { min: [0, 0, 0], max: [1, 2, 3] }, b: { min: [2, 0, 0], max: [2.5, 0.5, 0.5] } };
const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });
const doc = () => ({ objects: { a: object({ name: "A" }), b: object({ name: "B", group: "g" }), g: group() }, order: ["a", "b", "g"] });

async function mount(d = doc()) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.bounds" }, module: bounds }], kits: [{ id: "model", extensions: ["scene.bounds"] }], doc: d });
  const api = s.api("scene.bounds");
  // no WebGL here: the boxes the stage would measure
  api.box = (id) => (id === "g" ? BOXES.b : (BOXES[id] ?? null));
  return s;
}
const run = (s) => s.api("scene.bounds").run({ ext: "scene.bounds", command: "bounds", target: null });
const layer = (s) => s.debug.viewport.layers.get("scene.bounds").values().next().value;
const labels = (s) => [...s.root.querySelectorAll(".labels .bounds-label")].map((e) => e.textContent);

describe("scene.bounds (pure)", () => {
  it("labels a box's three sizes in the given units", () => {
    const l = sizeLabels("a", BOXES.a, "cm");
    expect(l.map((x) => x.text)).toEqual(["100 cm", "200 cm", "300 cm"]);
    expect(l[0].position).toEqual([0.5, 0, 3]);
    expect(l.map((x) => x.data.axis)).toEqual(["x", "y", "z"]);
  });
  it("sizes the selection if it's there, else every object", () => {
    const scene = { objects: doc().objects, ids: ["a", "b", "g"] };
    expect(boundsTargets(scene, null)).toEqual(["a", "b"]);
    expect(boundsTargets(scene, "g")).toEqual(["g"]);
    expect(boundsTargets(scene, "gone")).toEqual(["a", "b"]);
    expect(boundsTargets(scene, "dimension:d1")).toEqual(["a", "b"]); // a ref isn't an object: as if nothing were selected
  });
});

describe("scene.bounds", () => {
  it("is off by default; the command turns on boxes and sizes for every object", async () => {
    const s = await mount();
    const c = s.instance("scene.bounds").commands[0];
    expect(c.state(null, {})).toMatchObject({ checked: false });
    expect(c.state("a", {})).toBe(null);
    expect(labels(s)).toEqual([]);
    run(s);
    s.change((d) => (d.title = "poke")); // the stubbed boxes are read on the next pass
    await s.settle();
    expect(s.local.get().prefs.bounds).toBe(true);
    expect(s.doc().view.bounds).toBe(false);
    expect(labels(s)).toEqual(["1 m", "2 m", "3 m", "0.5 m", "0.5 m", "0.5 m"]);
    expect(layer(s).children.length).toBe(2);
    s.unmount();
  });

  it("with a selection, sizes only it and draws no box for it (the selection draws its own); follows units", async () => {
    const s = await mount({ ...doc(), view: { bounds: true } });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await s.settle();
    expect(labels(s)).toEqual(["1 m", "2 m", "3 m"]);
    expect(layer(s).children.length).toBe(0);
    s.api("scene.bounds").setPref("units", "mm");
    await s.settle();
    expect(labels(s)).toEqual(["1000 mm", "2000 mm", "3000 mm"]);
    // a selected group: its box
    s.local.swap((m) => ({ ...m, selected: "g" }));
    await s.settle();
    expect(labels(s)).toEqual(["500 mm", "500 mm", "500 mm"]);
    s.local.swap((m) => ({ ...m, selected: null }));
    await s.settle();
    expect(labels(s).length).toBe(6);
    expect(layer(s).children.length).toBe(2);
    s.unmount();
  });

  it("doesn't rebuild on a hover", async () => {
    const s = await mount({ ...doc(), view: { bounds: true } });
    s.change((d) => (d.title = "poke"));
    await s.settle();
    const first = layer(s).children[0];
    expect(first).toBeTruthy();
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    await s.settle();
    expect(layer(s).children[0]).toBe(first);
    s.unmount();
  });
});

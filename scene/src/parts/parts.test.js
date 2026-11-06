// scene.parts, the parts bin: lists the registered scene:parts by category
// (no panel without any), searches them, and puts one in by a click (where
// the view is looking) or a drop (where it lands: on an object, under it;
// on a tagged connector, snapped), through the stage's part(id, at).
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import sidebar from "./sidebar.js";
import parts, { OTHER, PART_MIME, SEARCH_FROM, byCategory, matches, partsOf, readPartDrag } from "./parts.js";
import { composeMatrix } from "../transform.js";

/** A part that puts one object (named after it) where it's told, and records what it was told. */
function partModule(name, calls) {
  return {
    async create(ctx, at) {
      calls.push(at);
      const id = ctx.newId("o");
      ctx.change((d) => {
        d.objects[id] = object({ name, parent: at.parent, transform: at.transform });
        d.order.push(id);
      });
      return id;
    },
  };
}

const EXTS = [
  { meta: { id: "scene.sidebar" }, module: sidebar },
  { meta: { id: "scene.parts" }, module: parts },
  // says what its traits are called, for the bin's "what it does"
  { meta: { id: "t.sail", traits: ["t.sail"], describes: { "t.sail": { name: "Sail" } } }, module: { create: () => ({}) } },
];

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

async function mount(list, doc = {}) {
  s = await mountStage({ extensions: EXTS, parts: list, doc });
  await settle();
  return s;
}

const section = () => s.root.querySelector('section[data-panel="parts"]');
const names = () => [...s.root.querySelectorAll(".part .part-name")].map((e) => e.textContent);
const button = (id) => s.root.querySelector(`.part[data-part="${id}"]`);

function dragEvent(type, data, { x = 0, y = 0, alt = false } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: Object.keys(data), dropEffect: "none", getData: (t) => data[t] ?? "" } });
  Object.defineProperty(e, "clientX", { value: x });
  Object.defineProperty(e, "clientY", { value: y });
  Object.defineProperty(e, "altKey", { value: alt });
  return e;
}

describe("pure", () => {
  it("partsOf keeps what the bin shows; byCategory groups in registry order, the uncategorised last", () => {
    const list = partsOf([
      { id: "a", name: "Mast", category: "Rig", tags: ["mast", 3], traits: ["t.sail"] },
      { id: "b", name: "Buoy" },
      { id: "c", name: "Wheel", category: "Deck" },
      { id: "d", name: "Sail", category: "Rig" },
      { name: "no id" },
    ]);
    expect(list[0]).toEqual({ id: "a", name: "Mast", icon: null, category: "Rig", description: null, tags: ["mast"], traits: ["t.sail"] });
    expect(byCategory(list).map((g) => [g.category, g.parts.map((p) => p.id)])).toEqual([
      ["Rig", ["a", "d"]],
      ["Deck", ["c"]],
      [OTHER, ["b"]],
    ]);
    expect(byCategory(partsOf([{ id: "x" }]))).toEqual([{ category: null, parts: [expect.objectContaining({ id: "x" })] }]);
    expect(byCategory([])).toEqual([]);
  });

  it("matches every word, in the name, category, tags or what its traits are called", () => {
    const [p] = partsOf([{ id: "a", name: "Mast and sail", category: "Rig", tags: ["mast"], traits: ["t.sail"] }]);
    expect(matches(p, "")).toBe(true);
    expect(matches(p, "RIG mast")).toBe(true);
    expect(matches(p, "wheel")).toBe(false);
    expect(matches(p, "canvas", (k) => (k === "t.sail" ? "Canvas" : k))).toBe(true);
  });

  it("readPartDrag", () => {
    expect(readPartDrag({ getData: (t) => (t === PART_MIME ? '{"part":"a"}' : "") })).toBe("a");
    expect(readPartDrag({ getData: () => "nope" })).toBe(null);
    expect(readPartDrag(null)).toBe(null);
  });
});

describe("the bin", () => {
  it("no parts registered: no panel", async () => {
    await mount([]);
    expect(section()?.hidden ?? true).toBe(true);
  });

  it("lists the parts by category, with what their traits are called", async () => {
    const calls = [];
    await mount([
      { meta: { id: "t.mast", name: "Mast", category: "Rig", traits: ["t.sail"], icon: "Sailboat" }, module: partModule("Mast", calls) },
      { meta: { id: "t.buoy", name: "Buoy" }, module: partModule("Buoy", calls) },
    ]);
    expect(section().hidden).toBe(false);
    expect([...s.root.querySelectorAll(".parts-category")].map((e) => e.textContent)).toEqual(["Rig", OTHER]);
    expect(names()).toEqual(["Mast", "Buoy"]);
    expect(button("t.mast").querySelector(".part-does").textContent).toBe("Sail");
    expect(button("t.mast").querySelector(".part-icon").dataset.icon).toBe("Sailboat");
    expect(button("t.mast").draggable).toBe(true);
    // few parts: no search
    expect(s.root.querySelector(".parts-search").hidden).toBe(true);
  });

  it("searches once there are enough", async () => {
    const calls = [];
    const list = Array.from({ length: SEARCH_FROM }, (_, i) => ({ meta: { id: `t.p${i}`, name: i === 3 ? "Windlass" : `Part ${i}` }, module: partModule("P", calls) }));
    await mount(list);
    const search = s.root.querySelector(".parts-search");
    expect(search.hidden).toBe(false);
    const input = search.querySelector("input");
    input.value = "wind";
    input.dispatchEvent(new Event("input"));
    expect(names()).toEqual(["Windlass"]);
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    expect(names()).toEqual([]);
    expect(s.root.querySelector(".parts-none").hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(names()).toHaveLength(SEARCH_FROM);
  });

  it("a click puts it where the view is looking, and selects it", async () => {
    const calls = [];
    await mount([{ meta: { id: "t.buoy", name: "Buoy" }, module: partModule("Buoy", calls) }]);
    button("t.buoy").click();
    await settle();
    // no view here (no WebGL): the orbit's target is taken as the origin, on the ground
    const origin = { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    expect(calls).toEqual([{ parent: null, transform: origin, world: origin }]);
    const id = s.local.get().selected;
    expect(s.doc().objects[id]?.name).toBe("Buoy");
  });

  it("a drop on an object goes under it at the drop point, locked or not; a tagged part snaps to its connector; Alt places freely; the ground takes the rest", async () => {
    const calls = [];
    const hullM = composeMatrix({ position: [5, 0, 0] });
    await mount(
      [
        { meta: { id: "t.mast", name: "Mast", tags: ["mast"] }, module: partModule("Mast", calls) },
        { meta: { id: "t.crate", name: "Crate" }, module: partModule("Crate", calls) },
      ],
      { objects: { hull: object({ name: "Hull", transform: { position: [5, 0, 0], rotation: [0, 0, 0], scale: 1 } }), floor: object({ name: "Floor", locked: true }) }, order: ["hull", "floor"] },
    );
    const api = s.api("scene.parts");
    // what's under the pointer, by x: the hull at x < 100, the floor at x < 200, else the ground
    api.pick = (x) => (x < 100 ? { id: "hull", point: [5.5, 1, 0.25] } : x < 200 ? { id: "floor", point: [1, 0.1, 1] } : { id: null, point: [9, 0, 9] });
    api.content = (id) => (id === "hull" ? { extras: { connectors: [{ position: [0, 1, 2], yaw: null, tags: ["mast"] }], snapRadius: 2 } } : null);
    const drop = async (part, at) => {
      const e = dragEvent("drop", { [PART_MIME]: JSON.stringify({ part }) }, at);
      s.canvas.dispatchEvent(e);
      await settle();
      return e;
    };
    // a crate on the hull: under it, where it was dropped, in its frame
    const e = await drop("t.crate", { x: 50 });
    expect(e.defaultPrevented).toBe(true);
    expect(calls.at(-1).parent).toBe("hull");
    expect(calls.at(-1).transform.position).toEqual([0.5, 1, 0.25]);
    expect(s.doc().objects[s.local.get().selected]).toMatchObject({ name: "Crate", parent: "hull" });
    // the mast goes to the mast step
    await drop("t.mast", { x: 50 });
    expect(calls.at(-1)).toMatchObject({ parent: "hull", transform: { position: [0, 1, 2] } });
    // Alt: where it was dropped
    await drop("t.mast", { x: 50, alt: true });
    expect(calls.at(-1).transform.position).toEqual([0.5, 1, 0.25]);
    expect(hullM[12]).toBe(5);
    // a locked object too: whether to ride along is the part's to say (it has `world` for that)
    await drop("t.crate", { x: 150 });
    expect(calls.at(-1)).toMatchObject({ parent: "floor", world: { position: [1, 0.1, 1] } });
    await drop("t.crate", { x: 250 });
    expect(calls.at(-1)).toMatchObject({ parent: null, transform: { position: [9, 0, 9] } });
    // a dragover over the view is taken (the drop is allowed), a document isn't ours
    const over = dragEvent("dragover", { [PART_MIME]: "" }, { x: 50 });
    s.canvas.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("copy");
    const doc = dragEvent("dragover", { "text/plain": "automerge:x" }, { x: 50 });
    s.canvas.dispatchEvent(doc);
    expect(doc.defaultPrevented).toBe(false);
    expect(calls).toHaveLength(5);
  });
});

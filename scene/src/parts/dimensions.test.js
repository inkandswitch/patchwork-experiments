import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as THREE from "three";
import { mountStage, object, until, settle } from "../test/stage-harness.js";
import dimensions, { SELECTED, detachEnds, dimensionList, resolveEnd, surfaceGapper } from "./dimensions.js";
import measure from "./measure.js";

const DIMS = { meta: { id: "scene.dimensions" }, module: dimensions };
const MEASURE = { meta: { id: "scene.measure" }, module: measure };
const KIT = { id: "model", extensions: ["scene.dimensions"] };
const T = (position = [0, 0, 0], rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const free = (world) => ({ objectId: null, local: null, world });
const on = (objectId, local, world = [0, 0, 0]) => ({ objectId, local, world });

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

async function mount({ objects = { a: object({ name: "A", transform: T([1, 0, 0]) }) }, dims = {}, extensions = [], kits = [KIT], doc = {} } = {}) {
  s = await mountStage({ extensions: [DIMS, ...extensions], kits, doc: { objects, order: Object.keys(objects), dimensions: dims, ...doc } });
  return s;
}

const api = () => s.api("scene.dimensions");
const inst = () => s.instance("scene.dimensions");
const run = (command, target = null) => api().run({ ext: "scene.dimensions", command, target });
const state = (command, target = null) => inst().commands.find((c) => c.id === command).state(target, { scene: api().scene(), local: s.local.get() });
const labels = () => [...s.port.querySelectorAll(".labels .dimension-label")];
const label = (id) => s.port.querySelector(`.labels .dimension-label[data-id="${id}"]`);
const layer = () => [...(s.debug.viewport.layers.get("scene.dimensions") ?? [])].flatMap((g) => g.children);
const selectedDim = () => s.local.get()[SELECTED] ?? null;
function panel() {
  const host = document.createElement("div");
  s.root.append(host);
  const p = inst().panels.find((x) => x.id === "dimensions");
  const handle = p.mount(host);
  return { host, handle, rows: () => [...host.querySelectorAll(".dimension-row")] };
}

describe("pure helpers", () => {
  it("resolves an end through its object's displayed world, else its stored point", () => {
    const objects = { a: {} };
    const worldOf = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1];
    expect(resolveEnd(on("a", [1, 0, 0], [9, 9, 9]), objects, worldOf)).toEqual({ world: [3, 0, 0], attached: true });
    expect(resolveEnd(on("gone", [1, 0, 0], [9, 9, 9]), objects, worldOf)).toEqual({ world: [9, 9, 9], attached: false });
    expect(resolveEnd(free([1, 2, 3]), objects, worldOf)).toEqual({ world: [1, 2, 3], attached: false });
  });

  it("lists dimensions with their name, length in units, and flags", () => {
    const list = dimensionList(
      { d1: { a: free([0, 0, 0]), b: free([0, 0, 0.0125]), label: "Gap" }, d2: { a: on("a", [0, 0, 0]), b: free([0, 3, 0]), label: null } },
      { a: {} },
      { worldOf: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], units: "mm", selected: "d2", gap: () => ({ distance: 1, tolerance: 0.001 }) },
    );
    expect(list.map((d) => [d.id, d.text, d.selected, d.detached, d.offSurface])).toEqual([
      ["d1", "Gap: 12.5 mm", false, true, false],
      ["d2", "3000 mm · off surface", true, true, true],
    ]);
  });

  it("detaches ends on removed objects, frozen where they are", () => {
    const objects = { a: { transform: T([1, 0, 0]) }, b: { transform: T([5, 0, 0]) } };
    const draft = { dimensions: { d1: { a: on("a", [0, 1, 0]), b: on("b", [0, 0, 0]) } } };
    expect(detachEnds(draft, ["a"], objects)).toBe(1);
    expect(draft.dimensions.d1.a).toEqual(free([1, 1, 0]));
    expect(draft.dimensions.d1.b).toEqual(on("b", [0, 0, 0]));
  });

  it("measures how far a point is from an object's geometry", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const gap = surfaceGapper(THREE);
    expect(gap(root, [0.5, 0, 0]).distance).toBeCloseTo(0, 6);
    expect(gap(root, [1.5, 0, 0]).distance).toBeCloseTo(1, 6);
    expect(gap(root, [1.5, 0, 0]).tolerance).toBeCloseTo(0.001, 6);
    expect(gap(null, [0, 0, 0])).toBeNull();
    expect(gap(new THREE.Group(), [0, 0, 0])).toBeNull();
  });
});

describe("scene.dimensions", () => {
  it("draws each dimension with a label in the viewer's units", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null }, d2: { a: free([0, 0, 0]), b: free([0, 2, 0]), label: "Height" } } });
    expect(labels().map((l) => l.textContent)).toEqual(["1 m", "Height: 2 m"]);
    expect(layer().map((o) => o.type)).toEqual(["LineSegments", "Points"]);
    api().setPref("units", "cm");
    await settle();
    expect(labels().map((l) => l.textContent)).toEqual(["100 cm", "Height: 200 cm"]);
    // a hover change redraws nothing
    const before = layer();
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    await settle();
    expect(layer()).toEqual(before);
  });

  it("an end on an object follows it, and whatever it's attached to (tool.test: a dimension on b follows a)", async () => {
    await mount({
      objects: { a: object({ name: "A", transform: T([1, 0, 0]) }), b: object({ name: "B", parent: "a", transform: T([0, 0, -2]) }) },
      dims: { d1: { a: on("b", [0, 0, 0], [1, 0, -2]), b: free([0, 0, 0]), label: null } },
    });
    expect(labels()[0].textContent).toBe("2.236 m");
    s.change((d) => {
      d.objects.a.transform.position = [3, 0, 0];
    });
    await settle();
    expect(labels()[0].textContent).toBe("3.606 m"); // b is now at (3,0,-2)
    expect(labels()[0].hasAttribute("data-detached")).toBe(true); // one end is free
  });

  it("marks an end whose object is gone as fixed", async () => {
    await mount({ dims: { d1: { a: on("a", [0, 0, 0]), b: on("a", [0, 1, 0]), label: null }, d2: { a: on("gone", [0, 0, 0], [5, 0, 0]), b: on("a", [0, 0, 0]), label: null } } });
    const p = panel();
    await settle();
    expect(label("d1").hasAttribute("data-detached")).toBe(false);
    expect(label("d2").hasAttribute("data-detached")).toBe(true);
    expect(label("d2").textContent).toBe("4 m"); // (5,0,0) to a's origin (1,0,0)
    const tags = p.rows().map((r) => [...r.querySelectorAll(".tag")].map((t) => t.textContent));
    expect(tags).toEqual([[], ["fixed"]]);
  });

  it("marks an end that's no longer on its object's surface", async () => {
    await mount({ dims: { d1: { a: on("a", [0.5, 0, 0]), b: on("a", [3, 0, 0]), label: null } } });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    api().content = (id) => (id === "a" ? { loaded: true, root } : null);
    const p = panel();
    // content loading flushes with the same scene and local
    s.debug.viewport.contentChanged?.();
    s.change((d) => {
      d.objects.a.name = "A2";
    });
    await until(() => labels()[0]?.textContent.includes("off surface"));
    expect(labels()[0].hasAttribute("data-offsurface")).toBe(true);
    expect(p.rows()[0].querySelector('.tag[data-tone="warn"]').textContent).toBe("off surface");
  });

  it("clicking a label selects it; the selected one is drawn in the accent", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null }, d2: { a: free([0, 0, 0]), b: free([0, 2, 0]), label: null } } });
    label("d2").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(selectedDim()).toBe("d2");
    await settle();
    expect(label("d2").hasAttribute("data-selected")).toBe(true);
    expect(label("d1").hasAttribute("data-selected")).toBe(false);
    const lines = layer().filter((o) => o.type === "LineSegments");
    expect(lines.length).toBe(2);
    const accent = s.local.get().theme.accent;
    const c = new THREE.Color().setRGB(accent[0], accent[1], accent[2], THREE.SRGBColorSpace);
    expect(lines[1].material.color.equals(c)).toBe(true);
    expect(lines[1].geometry.getAttribute("position").count).toBe(2);
  });

  it("Delete dimension and Deselect dimension apply only while one is selected, and are keys only", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null } } });
    const cmd = (id) => inst().commands.find((c) => c.id === id);
    expect(cmd("delete")).toMatchObject({ name: "Delete dimension", key: ["Delete", "Backspace"], show: [] });
    expect(cmd("deselect")).toMatchObject({ name: "Deselect dimension", key: "Escape", show: [] });
    expect(state("delete")).toBeNull();
    expect(state("deselect")).toBeNull();
    s.local.swap((m) => ({ ...m, [SELECTED]: "d1" }));
    expect(state("delete")).toBeTruthy();
    expect(state("delete", "a")).toBeNull(); // the scene's, not an object's
    expect(run("deselect")).toBe(true);
    expect(selectedDim()).toBeNull();
    s.local.swap((m) => ({ ...m, [SELECTED]: "d1" }));
    expect(run("delete")).toBe(true);
    expect(s.doc().dimensions.d1).toBeUndefined();
    expect(selectedDim()).toBeNull();
    expect(run("delete")).toBe(false);
  });

  it("the Dimensions panel lists them, selects on a click and deletes with ×", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null } } });
    expect(inst().panels.map((p) => [p.id, p.title])).toEqual([["dimensions", "Dimensions"]]);
    const p = panel();
    expect(p.rows().map((r) => r.dataset.id)).toEqual(["d1"]);
    p.rows()[0].querySelector(".row-main").click();
    expect(selectedDim()).toBe("d1");
    await settle();
    expect(p.rows()[0].hasAttribute("data-selected")).toBe(true);
    p.rows()[0].querySelector(".icon-button").click();
    await settle();
    expect(s.doc().dimensions.d1).toBeUndefined();
    expect(selectedDim()).toBeNull();
    expect(p.rows()).toEqual([]);
    expect(p.host.querySelector(".empty-row").textContent).toBe("Use Measure to add one.");
    expect(labels()).toEqual([]);
    p.handle.dispose();
    expect(p.host.querySelector(".dimension-list")).toBeNull();
  });

  it("the panel's update works even before the extension's own (the sidebar may come first)", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null } } });
    const p = panel();
    s.change((d) => {
      d.dimensions.d2 = { a: free([0, 0, 0]), b: free([0, 0, 2]), label: null };
    });
    p.handle.update(api().scene(), s.local.get());
    expect(p.rows().map((r) => r.dataset.id)).toEqual(["d1", "d2"]);
  });

  it("forgets the selected dimension when it goes (a peer deleted it)", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null } } });
    s.local.swap((m) => ({ ...m, [SELECTED]: "d1" }));
    await settle();
    s.change((d) => {
      delete d.dimensions.d1;
    });
    await settle();
    expect(selectedDim()).toBeNull();
  });

  it("one selection at a time: a dimension or an object", async () => {
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null } } });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    label("d1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await settle();
    expect(selectedDim()).toBe("d1");
    expect(s.local.get().selected).toBeNull();
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    expect(selectedDim()).toBeNull();
    expect(s.local.get().selected).toBe("a");
    // a dimension selected by someone else (measure) wins over the object
    s.local.swap((m) => ({ ...m, [SELECTED]: "d1" }));
    await settle();
    expect(selectedDim()).toBe("d1");
    expect(s.local.get().selected).toBeNull();
  });

  it("a click in the view lets go of the dimension without claiming the click", async () => {
    const clicks = [];
    const sel = { meta: { id: "t.select" }, module: { create: () => ({ input: { click: () => (clicks.push(1), true) } }) } };
    await mount({ dims: { d1: { a: free([0, 0, 0]), b: free([0, 0, 1]), label: null } }, extensions: [sel], kits: [{ id: "model", extensions: ["scene.dimensions", "t.select"] }] });
    s.local.swap((m) => ({ ...m, [SELECTED]: "d1" }));
    s.click();
    expect(selectedDim()).toBeNull();
    expect(clicks).toEqual([1]);
  });

  it("removing an object detaches its dimensions instead of deleting them (tool.test)", async () => {
    await mount({ dims: { d1: { a: on("a", [0, 0, 0], [0, 0, 0]), b: free([1, 1, 0]), label: null } } });
    const p = panel();
    expect(p.rows().length).toBe(1);
    api().remove(["a"]);
    await settle();
    expect(s.doc().objects.a).toBeUndefined();
    expect(s.doc().dimensions.d1.a).toEqual({ objectId: null, local: null, world: [1, 0, 0] });
    expect(p.rows().length).toBe(1);
    expect(p.rows()[0].querySelector(".tag").textContent).toBe("fixed");
  });

  it("removing a group detaches ends on everything in it (tool-v3.test)", async () => {
    const objects = {
      vessel: { kind: "group", name: "Vessel", group: null, visible: true, opacity: 1 },
      hull: object({ name: "Hull", group: "vessel", transform: T([0, -0.7, 0]) }),
      cell: object({ name: "Cell" }),
    };
    await mount({ objects, dims: { d1: { a: on("hull", [0, 0, 0], [0, -0.7, 0]), b: free([1, 0, 0]), label: null } } });
    api().remove(["vessel"]);
    await settle();
    expect(Object.keys(s.doc().objects)).toEqual(["cell"]);
    expect(s.doc().dimensions.d1.a).toEqual({ objectId: null, local: null, world: [0, -0.7, 0] });
  });
});

describe("measure and dimensions together", () => {
  it("a measured dimension is drawn, listed and selected", async () => {
    await mount({ extensions: [MEASURE], kits: [{ id: "model", extensions: ["scene.measure", "scene.dimensions"] }] });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    const p = panel();
    s.api("scene.measure").run({ ext: "scene.measure", command: "measure", target: null });
    let hit = { id: null, point: [0, 0, 0], snapped: false, ground: true };
    s.debug.viewport.pick = (x, y, o) => (o?.ground ? hit : null);
    s.click();
    hit = { id: "a", point: [1, 0, 0], snapped: true };
    s.click();
    await settle();
    const [id] = Object.keys(s.doc().dimensions);
    expect(selectedDim()).toBe(id);
    expect(s.local.get().selected).toBeNull();
    expect(label(id).textContent).toBe("1 m");
    expect(label(id).hasAttribute("data-selected")).toBe(true);
    expect(p.rows().map((r) => r.dataset.id)).toEqual([id]);
    // Escape goes to the armed measure first (it stops), not to Deselect dimension
    s.key("Escape", { code: "Escape" });
    expect(selectedDim()).toBe(id);
  });
});

import { describe, it, expect } from "vitest";
import { Group, Object3D } from "three";
import { sanitizeLayers, layerStates, layerShown, nodeLayer, layersKey } from "./layers.js";

const ids = (t) => t.map((e) => `${"  ".repeat(e.depth)}${e.id}`);

describe("sanitizeLayers", () => {
  it("is empty for anything but a list", () => {
    for (const raw of [undefined, null, 3, "a", {}, { id: "a" }]) expect(sanitizeLayers(raw)).toEqual([]);
  });

  it("drops entries without a string id, and repeats of an id (the first stays)", () => {
    const t = sanitizeLayers([{ id: "a", name: "A" }, null, 7, { name: "no id" }, { id: "" }, { id: 3 }, { id: "a", name: "again" }, { id: "b" }]);
    expect(ids(t)).toEqual(["a", "b"]);
    expect(t[0].name).toBe("A");
  });

  it("names a layer by its id when it has no name, and shows it unless it says visible: false", () => {
    const [a, b, c] = sanitizeLayers([{ id: "a" }, { id: "b", visible: false }, { id: "c", visible: 0 }]);
    expect([a.name, a.visible, b.visible, c.visible]).toEqual(["a", true, false, true]);
  });

  it("orders it as a tree, in the GLB's order, whatever order parents come in", () => {
    const t = sanitizeLayers([{ id: "deck", parent: "hull" }, { id: "rig" }, { id: "hull" }, { id: "cabin", parent: "deck" }, { id: "mast", parent: "rig" }, { id: "keel", parent: "hull" }]);
    expect(ids(t)).toEqual(["rig", "  mast", "hull", "  deck", "    cabin", "  keel"]);
  });

  // each way a parent link can be wrong: the link is cut, nothing is lost, and
  // a loop is broken at its first entry in the GLB's order
  const badParents = [
    ["names a layer that isn't there", [{ id: "a", parent: "ghost" }], ["a"]],
    ["names itself", [{ id: "a", parent: "a" }], ["a"]],
    ["isn't a string", [{ id: "a", parent: 4 }], ["a"]],
    ["closes a loop of two", [{ id: "a", parent: "b" }, { id: "b", parent: "a" }], ["a", "  b"]],
    ["closes a loop of three", [{ id: "a", parent: "c" }, { id: "b", parent: "a" }, { id: "c", parent: "b" }], ["a", "  b", "    c"]],
    // t hangs off the loop without being in it: it keeps its parent
    ["closes a loop a tail leads into", [{ id: "t", parent: "a" }, { id: "a", parent: "b" }, { id: "b", parent: "a" }], ["a", "  t", "  b"]],
  ];
  for (const [why, raw, want] of badParents) {
    it(`cuts a parent link that ${why}`, () => {
      expect(ids(sanitizeLayers(raw))).toEqual(want);
    });
  }
});

describe("layerStates", () => {
  const table = sanitizeLayers([
    { id: "hull" },
    { id: "deck", parent: "hull" },
    { id: "ghost", parent: "hull", visible: false },
    { id: "rig", visible: false },
    { id: "mast", parent: "rig" },
  ]);
  const shown = (choices) => Object.fromEntries([...layerStates(table, choices)].map(([k, v]) => [k, v.shown]));

  it("is the GLB's visibility when nobody has chosen", () => {
    expect(shown(undefined)).toEqual({ hull: true, deck: true, ghost: false, rig: false, mast: false });
  });

  it("hides what's in a hidden layer, though its own state is on", () => {
    const s = layerStates(table, { hull: false });
    expect(s.get("deck")).toEqual({ on: true, chosen: false, shown: false });
    expect(s.get("hull")).toEqual({ on: false, chosen: true, shown: false });
  });

  it("shows a layer the GLB hides once someone turns it on, and what's in it", () => {
    expect(shown({ rig: true })).toMatchObject({ rig: true, mast: true });
    expect(shown({ ghost: true })).toMatchObject({ ghost: true });
  });

  it("keeps a child's own choice under a hidden parent, to show again with it", () => {
    const s = layerStates(table, { hull: false, deck: false });
    expect(s.get("deck")).toEqual({ on: false, chosen: true, shown: false });
    expect(layerStates(table, { deck: false }).get("deck").shown).toBe(false);
    expect(layerStates(table, { hull: true, deck: true }).get("deck").shown).toBe(true);
  });

  it("ignores choices that aren't booleans, or name layers the table doesn't have", () => {
    expect(shown({ hull: "no", deck: 0, nowhere: false })).toEqual(shown(undefined));
  });
});

describe("layerShown", () => {
  const states = layerStates(sanitizeLayers([{ id: "a", visible: false }]), {});
  it("hides a mesh on a hidden layer; always shows one on no layer, or on one the table doesn't have", () => {
    expect(layerShown(states, "a")).toBe(false);
    expect(layerShown(states, null)).toBe(true);
    expect(layerShown(states, "unknown")).toBe(true);
  });
});

describe("nodeLayer", () => {
  it("is the node's own layer, else its nearest ancestor's, not past the root", () => {
    const above = new Group();
    above.userData.layer = "outside";
    const root = new Group();
    above.add(root);
    const a = new Group();
    a.userData.layer = "a";
    const b = new Object3D();
    b.userData.layer = "b";
    const plain = new Object3D();
    root.add(a);
    a.add(b, plain);
    const loose = new Object3D();
    root.add(loose);
    expect(nodeLayer(b, root)).toBe("b");
    expect(nodeLayer(plain, root)).toBe("a");
    expect(nodeLayer(loose, root)).toBe(null);
  });
});

describe("choices", () => {
  it("key changes iff the choices do, whatever order they were written in", () => {
    expect(layersKey({ b: false, a: true })).toBe(layersKey({ a: true, b: false }));
    expect(layersKey({ a: true })).not.toBe(layersKey({ a: false }));
    expect(layersKey({ a: true, junk: 1 })).toBe(layersKey({ a: true }));
    expect(layersKey(undefined)).toBe("");
  });
});

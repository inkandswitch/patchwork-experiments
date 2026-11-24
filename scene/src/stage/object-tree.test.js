// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { createObjectTree } from "./object-tree.js";
import { display } from "./object-content.js";

/** A tree, and a way to show an object in it as the viewport does (display under its parent). */
function tree() {
  let changes = 0;
  const root = new Group();
  const t = createObjectTree({ root, changed: () => changes++ });
  const show = (id, obj, parent = null, inherited = null) => {
    const e = t.ensure(id);
    t.setParent(id, parent);
    display(e, obj, inherited, t.poses.get(id) ?? obj.transform, null);
    return e;
  };
  const cube = (id, at = [0, 0, 0]) => {
    const e = show(id, { transform: { position: at } });
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    e.content = mesh;
    e.box = new Box3().setFromObject(mesh);
    e.body.add(mesh);
    return e;
  };
  return { t, root, show, cube, changes: () => changes };
}

describe("the object tree", () => {
  it("a held pose beats the doc's transform until it's let go, and says what changed", () => {
    const { t, show, changes } = tree();
    show("p", { transform: { position: [1, 0, 0] } });
    t.setPose("p", { position: [0, 2, 0], rotation: [0, 0, 0], scale: 1 });
    expect(t.worldOf("p").slice(12, 15)).toEqual([0, 2, 0]);
    // the doc changing underneath doesn't move it
    show("p", { transform: { position: [5, 0, 0] } });
    expect(t.worldOf("p").slice(12, 15)).toEqual([0, 2, 0]);
    t.setPose("p", null);
    expect(t.worldOf("p").slice(12, 15)).toEqual([5, 0, 0]);
    expect(changes()).toBe(2);
    expect(t.worldOf("missing")).toBe(null);
  });

  it("a pose composes with the parent, and applies to an object that arrives later", () => {
    const { t, show } = tree();
    show("parent", { transform: { position: [10, 0, 0], scale: 2 } });
    t.setPose("child", { position: [1, 0, 0] });
    show("child", { transform: { position: [0, 0, 0] } }, "parent");
    const m = t.worldOf("child");
    expect(m.slice(12, 15)).toEqual([12, 0, 0]);
    expect(m[0]).toBe(2);
  });

  it("what's shown: hidden objects and groups are neither yielded, boxed, nor picked; a group's box is its shown members'", () => {
    const { t, show, cube } = tree();
    cube("a", [0, 0, 0]);
    cube("b", [3, 0, 0]);
    show("g", { kind: "group" });
    expect(t.setGroups(new Map([["g", ["a", "b"]]]))).toBe(true);
    expect(t.setGroups(new Map([["g", ["a", "b"]]]))).toBe(false);
    expect(t.objectBox("g").max.x).toBeCloseTo(3.5);
    expect([...t.shown()].map((s) => s.id)).toEqual(["a", "b"]);
    show("b", { visible: false, transform: { position: [3, 0, 0] } });
    expect(t.objectBox("g").max.x).toBeCloseTo(0.5);
    expect([...t.shown()].map((s) => s.id)).toEqual(["a"]);
    expect(t.bodies()).toEqual([t.entries.get("a").body]);
    expect(t.bodies((id) => id === "a")).toEqual([]);
    expect(t.sceneBox().max.x).toBeCloseTo(0.5);
  });

  it("removing an object leaves what hangs under it at the root, and says so", () => {
    const { t, root, show, changes } = tree();
    show("L", { transform: { position: [10, 0, 0] } });
    show("a", { transform: {} }, "L");
    t.remove("L");
    expect(t.entries.get("a").group.parent).toBe(root);
    expect(t.entries.has("L")).toBe(false);
    expect(changes()).toBe(1);
  });
});

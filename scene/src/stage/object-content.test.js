import { describe, it, expect } from "vitest";
import { Color, Matrix4, Raycaster, Vector3 } from "three";
import { encodeGLB } from "../glb.js";
import { prepareGLB } from "../gltf-content.js";
import { nearestHit } from "./picking.js";
import { bodyBox, contentExtras, contentOf, display, newEntry, placeholderLook, setHint, swapGLB } from "./object-content.js";

const swap = (entry, bytes, stale = () => false) => swapGLB(entry, bytes, { compile: async () => {}, stale, compiling: new Set(), themeColor: () => new Color() });
const unit = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];

describe("content extras", () => {
  it("carry the GLB scene's own extras, its connectors, how far they reach (the GLB's, else from their spacing), and its raw legend", async () => {
    const glb = (nodeExtras) =>
      encodeGLB({ meshes: [{ positions: [0, 0, 0, 1, 0, 0, 0, 0, 1] }], nodes: [{ mesh: 0, extras: nodeExtras }], extras: { seats: 4, connectors: "raw, replaced", legend: "raw scene legend" } });
    const x = contentExtras(await prepareGLB(glb({ connectors: [[0, 0, 0], [2, 0, 0]] })));
    expect(x.seats).toBe(4);
    expect(x.connectors.map((p) => p.position)).toEqual([[0, 0, 0], [2, 0, 0]]);
    // none given: from the connectors' spacing in plan (0.71 × 2 m)
    expect(x.snapRadius).toBeCloseTo(2 * Math.SQRT1_2);
    expect(Object.isFrozen(x)).toBe(true);
    expect(contentExtras(await prepareGLB(glb({ connectors: [[0, 0, 0]], snapRadius: 0.3 }))).snapRadius).toBe(0.3);
    // one connector and no radius: no reach
    expect(contentExtras(await prepareGLB(glb({ connectors: [[0, 0, 0]] }))).snapRadius).toBe(null);
    expect(contentExtras({ snap: { points: [], radius: null }, legend: null })).toEqual({ connectors: [], snapRadius: null, legend: null, layers: [] });
  });
});

describe("a hint, then the GLB", () => {
  it("a hint is a placeholder box, in body space, until the GLB arrives and takes its place", async () => {
    const entry = newEntry("h");
    const look = placeholderLook(new Color());
    expect(setHint(entry, { min: [0, 0, 0], max: [1, 2, 3] }, look)).toBe(true);
    expect(setHint(entry, { min: [0, 0, 0], max: [1, 2, 3] }, look)).toBe(false); // the same: nothing to do
    expect(contentOf(entry)).toEqual({ loaded: false, box: { min: [0, 0, 0], max: [1, 2, 3] }, extras: null, stats: null, root: null });
    expect(entry.body.children).toContain(entry.placeholder);
    // moved to x = 5, its box in body space is the same
    entry.group.position.set(5, 0, 0);
    expect(contentOf(entry).box.min).toEqual([0, 0, 0]);
    expect(bodyBox(entry, new Matrix4().makeTranslation(5, 0, 0)).min.toArray()).toEqual([5, 0, 0]);
    expect(bodyBox(entry, new Matrix4(), false)).toBe(null);
    await swap(entry, encodeGLB({ meshes: [{ positions: new Float32Array(unit), indices: [0, 1, 2] }], nodes: [{ mesh: 0 }] }));
    expect(entry.placeholder).toBe(null);
    expect(contentOf(entry)).toMatchObject({ loaded: true, root: entry.content });
    expect(contentOf(entry).box).toEqual({ min: [0, 0, 0], max: [1, 1, 1] });
  });

  it("a swap overtaken while it prepares is dropped, and what was there stays", async () => {
    const entry = newEntry("o");
    expect(await swap(entry, encodeGLB({ meshes: [{ positions: new Float32Array(unit), indices: [0, 1, 2] }], nodes: [{ mesh: 0 }] }), () => true)).toBe(null);
    expect(entry.content).toBe(null);
  });
});

describe("layers", () => {
  // three 1 m boxes in a row along x: hull at 0, deck (in hull) at 2, rig at 4
  // (hidden in the file), plus one on no layer at -2
  const layered = () =>
    encodeGLB({
      meshes: [{ name: "piece", positions: new Float32Array(unit), indices: [0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2] }],
      nodes: [
        { name: "hull", mesh: 0, translation: [0, 0, 0], extras: { layer: "hull" } },
        { name: "deck", mesh: 0, translation: [2, 0, 0], extras: { layer: "deck" } },
        { name: "rig", mesh: 0, translation: [4, 0, 0], extras: { layer: "rig" } },
        { name: "loose", mesh: 0, translation: [-2, 0, 0] },
      ],
      extras: { layers: [{ id: "hull", name: "Hull" }, { id: "deck", name: "Deck", parent: "hull" }, { id: "rig", name: "Rig", visible: false }] },
    });
  const shownNames = (entry) => {
    const out = [];
    entry.content.traverse((m) => m.isMesh && m.visible && out.push(...(m.userData.instancedFrom ?? [m.name])));
    return out.sort();
  };
  const xSpan = (entry) => {
    const b = bodyBox(entry, new Matrix4());
    return b ? [+b.min.x.toFixed(6), +b.max.x.toFixed(6)] : null;
  };
  const show = (entry, layers) => display(entry, { transform: {}, ...(layers ? { layers } : {}) }, null, {}, new Color());

  it("shows what the file shows, boxes only that, and says what the layers are", async () => {
    const entry = newEntry("o");
    show(entry);
    await swap(entry, layered());
    expect(shownNames(entry)).toEqual(["deck", "hull", "loose"]);
    expect(xSpan(entry)).toEqual([-2, 3]);
    expect(contentOf(entry).extras.layers.map((l) => [l.id, l.depth])).toEqual([["hull", 0], ["deck", 1], ["rig", 0]]);
  });

  it("follows the object's choices: a hidden parent hides what's in it, and turning on a hidden layer shows it", async () => {
    const entry = newEntry("o");
    show(entry);
    await swap(entry, layered());
    show(entry, { hull: false, rig: true });
    expect(shownNames(entry)).toEqual(["loose", "rig"]);
    expect(xSpan(entry)).toEqual([-2, 5]);
    show(entry, { hull: false, rig: false });
    expect(shownNames(entry)).toEqual(["loose"]);
    expect(xSpan(entry)).toEqual([-2, -1]);
    show(entry);
    expect(shownNames(entry)).toEqual(["deck", "hull", "loose"]);
  });

  it("applies choices made before the GLB arrived", async () => {
    const entry = newEntry("o");
    show(entry, { deck: false });
    await swap(entry, layered());
    expect(shownNames(entry)).toEqual(["hull", "loose"]);
  });

  it("doesn't pick a hidden layer", async () => {
    const entry = newEntry("o");
    show(entry, { rig: true });
    await swap(entry, layered());
    entry.group.updateMatrixWorld(true);
    const hit = () => {
      const rc = new Raycaster(new Vector3(4.25, 0.25, 5), new Vector3(0, 0, -1));
      return nearestHit(rc, [entry.content]);
    };
    expect(hit()).not.toBeNull();
    show(entry, { rig: false });
    expect(hit()).toBeNull();
  });
});

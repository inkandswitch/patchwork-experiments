import { describe, it, expect, vi } from "vitest";
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene } from "three";
import { aimRay } from "./picking.js";
import { addLayer, followLayers, layerMeshes, removeLayers, widgetAt } from "./widget-layers.js";

const SIZE = { w: 200, h: 100 };
const ball = (z, data = {}) => {
  const m = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
  m.position.z = z;
  Object.assign(m.userData, data);
  return m;
};

/** The world's two passes and a camera looking down −z from z = 10. */
function world() {
  const widgets = new Group();
  const top = new Scene();
  const cam = new PerspectiveCamera(45, SIZE.w / SIZE.h, 0.01, 1000);
  cam.position.set(0, 0, 10);
  cam.updateMatrixWorld();
  const layers = new Map();
  const at = (x, y) => {
    widgets.updateMatrixWorld(true);
    top.updateMatrixWorld(true);
    return widgetAt(layerMeshes(layers), aimRay(new Raycaster(), cam, SIZE, x, y));
  };
  return { widgets, top, layers, at };
}

describe("widget layers", () => {
  it("picks the nearest widget, an onTop one over any other, with the userData of the mesh and the groups above it", () => {
    const w = world();
    addLayer(w.layers, "halo", {}, w.widgets).add(ball(3, { axis: "x" }));
    expect(w.at(100, 50)).toMatchObject({ owner: "halo", onTop: false, userData: { axis: "x" } });
    const holder = new Group();
    holder.userData.param = "length";
    holder.add(ball(-3, { knob: true }));
    addLayer(w.layers, "handles", { onTop: true }, w.top).add(holder);
    const hit = w.at(100, 50);
    expect(hit).toMatchObject({ owner: "handles", onTop: true, userData: { param: "length", knob: true } });
    expect(hit.distance).toBeCloseTo(12.9);
    expect(w.at(0, 0)).toBe(null);
  });

  it("never picks noPick subtrees or hidden ones", () => {
    const w = world();
    const g = addLayer(w.layers, "x", {}, w.widgets);
    const inert = new Group();
    inert.userData.noPick = true;
    inert.add(ball(0));
    g.add(inert);
    expect(w.at(100, 50)).toBe(null);
    const hidden = ball(1);
    hidden.visible = false;
    g.add(hidden);
    expect(w.at(100, 50)).toBe(null);
    const shown = ball(2);
    g.add(shown);
    expect(w.at(100, 50).object).toBe(shown);
    g.visible = false;
    expect(w.at(100, 50)).toBe(null);
  });

  it("removes and disposes an owner's groups, and only its", () => {
    const w = world();
    const a = addLayer(w.layers, "a", {}, w.widgets);
    const a2 = addLayer(w.layers, "a", { onTop: true }, w.top);
    const b = addLayer(w.layers, "b", {}, w.widgets);
    const m = ball(0);
    const geometry = vi.spyOn(m.geometry, "dispose");
    const material = vi.spyOn(m.material, "dispose");
    a.add(m);
    expect(removeLayers(w.layers, "a")).toBe(true);
    expect([a.parent, a2.parent, b.parent]).toEqual([null, null, w.widgets]);
    expect(geometry).toHaveBeenCalled();
    expect(material).toHaveBeenCalled();
    expect(w.layers.has("a")).toBe(false);
    expect(removeLayers(w.layers, "a")).toBe(false);
  });

  it("a layer under a node hangs where the node is drawn, and is drawn only while it is", () => {
    const w = world();
    const g = addLayer(w.layers, "seats", { under: "L" }, w.widgets);
    g.add(ball(0));
    let shown = true;
    const at = new Matrix4().makeTranslation(0, 0, 4).toArray();
    followLayers(w.layers, (key) => (key === "L" ? at : null), () => shown);
    w.widgets.updateMatrixWorld(true);
    expect(g.parent.matrixWorld.toArray()).toEqual(at);
    expect(w.at(100, 50).distance).toBeCloseTo(5.9);
    shown = false;
    followLayers(w.layers, () => at, () => shown);
    expect(w.at(100, 50)).toBe(null);
    // removing it takes its anchor too
    removeLayers(w.layers, "seats");
    expect(w.widgets.children).toEqual([]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { encodeGLB } from "../glb.js";
import { prepareGLB } from "../gltf-content.js";
import { defaultSnapRadius } from "../hand.js";
import {
  LIGHTS,
  LabelLayer,
  Viewport,
  cleanAtmosphere,
  contentExtras,
  declutter,
  depthRange,
  intersectLimits,
  lighting,
  nearestScreenVertex,
  reseatTarget,
  resetOrbitMotion,
  sunFrame,
  toBox3,
} from "./viewport.js";

/** Rounded, and without -0, for comparing vectors. */
const r6 = (a) => a.map((v) => Math.round(v * 1e6) / 1e6 + 0);

// happy-dom has no WebGL, so the renderer can't be built. Everything that
// doesn't draw (the camera rig, picking, layers, poses, depth) runs on a
// viewport put together from the same init steps the constructor uses.
function headless({ w = 200, h = 100 } = {}) {
  const port = document.createElement("div");
  document.body.append(port);
  const vp = Object.create(Viewport.prototype);
  vp.port = port;
  vp.themeRoot = port;
  vp.initState();
  vp.size = { w, h };
  vp.initScene();
  vp.initControls(port);
  vp.camera.aspect = w / h;
  vp.camera.updateProjectionMatrix();
  vp.ok = true;
  return vp;
}

/** An object with a 1 m cube as its content, at `at`. */
function cube(vp, id, at = [0, 0, 0], size = 1) {
  const entry = vp.ensureObject(id);
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial());
  entry.content = mesh;
  entry.box = new Box3().setFromObject(mesh);
  entry.body.add(mesh);
  vp.applyDisplay(id, { transform: { position: at } });
  return entry;
}

function lookFrom(vp, position, target = [0, 0, 0]) {
  vp.setCamera({ position, target });
  vp.camera.updateMatrixWorld();
}

describe("LabelLayer", () => {
  const items = (layer, owner) => [...(layer.groups.get(owner)?.values() ?? [])];

  it("keeps each owner's labels apart, keyed within the owner", () => {
    const parent = document.createElement("div");
    const onChange = vi.fn();
    const layer = new LabelLayer(parent, onChange);
    layer.sync("measure", [{ key: "a", text: "1 m", position: [0, 0, 0] }, { key: "b", text: "2 m", position: [1, 0, 0] }]);
    layer.sync("grid", [{ key: "a", text: "x", position: [0, 0, 0] }]);
    expect(layer.el.querySelectorAll(".label")).toHaveLength(3);
    expect(onChange).toHaveBeenCalledTimes(2);
    // a re-sync keeps the element of a key it still has
    const el = items(layer, "measure")[0].el;
    layer.sync("measure", [{ key: "a", text: "1.5 m", position: [0, 0, 0] }]);
    expect(items(layer, "measure")[0].el).toBe(el);
    expect(el.textContent).toBe("1.5 m");
    expect(layer.el.querySelectorAll(".label")).toHaveLength(2);
    // clearing one owner leaves the other's
    layer.clear("measure");
    expect(layer.groups.has("measure")).toBe(false);
    expect(layer.el.querySelectorAll(".label")).toHaveLength(1);
    expect(items(layer, "grid")[0].el.textContent).toBe("x");
  });

  it("takes position, or the middle of its ends", () => {
    const layer = new LabelLayer(document.createElement("div"));
    layer.sync("o", [
      { key: "p", text: "p", position: [1, 2, 3] },
      { key: "e", text: "e", ends: [[0, 0, 0], [2, 0, 0]] },
      { key: "s", text: "s", screen: { x: 10, y: 20 } },
      { text: "no key" },
    ]);
    const [p, e, s] = items(layer, "o");
    expect(p.world.toArray()).toEqual([1, 2, 3]);
    expect(e.world.toArray()).toEqual([1, 0, 0]);
    expect(s.screen).toEqual({ x: 10, y: 20 });
    expect(items(layer, "o")).toHaveLength(3);
    const seen = [];
    layer.update((v) => (seen.push(v.toArray()), { x: v.x * 10, y: v.y * 10 }));
    expect(s.el.style.transform).toContain("translate(10px, 20px)");
    expect(p.el.style.transform).toContain("translate(10px, 20px)");
  });

  it("hides what it can't place, and drops data attributes that went away", () => {
    const layer = new LabelLayer(document.createElement("div"));
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0], data: { axis: "x", selected: true } }]);
    const el = items(layer, "o")[0].el;
    expect(el.getAttribute("data-axis")).toBe("x");
    expect(el.hasAttribute("data-selected")).toBe(true);
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0], data: { selected: false } }]);
    expect(el.hasAttribute("data-axis")).toBe(false);
    expect(el.hasAttribute("data-selected")).toBe(false);
    layer.update(() => null);
    expect(el.style.display).toBe("none");
  });

  it("calls onPointerDown without letting the press through", () => {
    const layer = new LabelLayer(document.createElement("div"));
    const down = vi.fn();
    layer.sync("o", [{ key: "k", text: "t", position: [0, 0, 0], onPointerDown: down }]);
    const ev = new Event("pointerdown", { bubbles: true });
    const stop = vi.spyOn(ev, "stopPropagation");
    items(layer, "o")[0].el.dispatchEvent(ev);
    expect(down).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalled();
  });

  it("declutters every owner's labels together, by their rank (1 when they don't say)", () => {
    const layer = new LabelLayer(document.createElement("div"));
    // a label that asks for rank 1.5 beats one that says nothing (1) where they overlap, whatever their classes
    layer.sync("grid", [{ key: "g", text: "grid", className: "grid-label", position: [0, 0, 0], rank: 1.5 }]);
    layer.sync("bounds", [{ key: "b", text: "bounds", className: "dimension-label", position: [0, 0, 0] }]);
    for (const entries of layer.groups.values())
      for (const e of entries.values()) {
        Object.defineProperty(e.el, "offsetWidth", { value: 40 });
        Object.defineProperty(e.el, "offsetHeight", { value: 14 });
      }
    layer.update(() => ({ x: 100, y: 100 }));
    const g = items(layer, "grid")[0].el;
    const b = items(layer, "bounds")[0].el;
    expect(g.style.visibility).toBe("");
    expect(b.style.visibility).toBe("hidden");
  });
});

describe("declutter", () => {
  function label(cls, x, y, rank) {
    const el = document.createElement("div");
    el.className = `label ${cls}`;
    el.textContent = cls;
    Object.defineProperty(el, "offsetWidth", { value: 40 });
    Object.defineProperty(el, "offsetHeight", { value: 14 });
    return { el, p: { x, y }, rank };
  }
  it("ranks by the item's own rank, not its class, and never hides rank 2 and up", () => {
    const dim = label("dimension-label", 100, 100, -1); // ranked down below the grid
    const grid = label("grid-label", 102, 100, 0);
    declutter([dim, grid]);
    expect(grid.el.style.visibility).toBe("");
    expect(dim.el.style.visibility).toBe("hidden");
    const a = label("x", 300, 100, 5);
    const b = label("y", 302, 100, 2);
    declutter([a, b]);
    expect(a.el.style.visibility).toBe("");
    expect(b.el.style.visibility).toBe("");
  });
});

describe("nearestScreenVertex", () => {
  it("is still exported, and finds the vertex nearest the cursor", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const pts = [0, 0, 0, 0.5, 0.5, 0];
    const r = nearestScreenVertex(pts, { count: 2 }, identity, identity, { width: 100, height: 100, x: 76, y: 24, maxPx: 5, eye: [0, 0, 5] });
    expect(r.index).toBe(1);
    expect(r.world).toEqual([0.5, 0.5, 0]);
  });
});

describe("camera limits", () => {
  it("intersect: the tightest of each bound, defaults where none is given", () => {
    expect(intersectLimits([])).toEqual({ minPolar: 0, maxPolar: Math.PI, minDistance: 0, maxDistance: Infinity });
    expect(intersectLimits([{ maxPolar: 1.4 }, { maxPolar: 1.2, minDistance: 2 }, { minDistance: 1, maxDistance: 10 }, null])).toEqual({
      minPolar: 0,
      maxPolar: 1.2,
      minDistance: 2,
      maxDistance: 10,
    });
  });
  it("collapse onto the larger minimum when they can't all hold, and stay in range", () => {
    expect(intersectLimits([{ minPolar: 1 }, { maxPolar: 0.5 }])).toMatchObject({ minPolar: 1, maxPolar: 1 });
    expect(intersectLimits([{ minDistance: 5 }, { maxDistance: 3 }])).toMatchObject({ minDistance: 5, maxDistance: 5 });
    expect(intersectLimits([{ minPolar: -1, maxPolar: 9, minDistance: -2, maxDistance: "x" }])).toEqual({ minPolar: 0, maxPolar: Math.PI, minDistance: 0, maxDistance: Infinity });
  });
});

describe("re-seating the orbit", () => {
  it("puts the target straight ahead at the old distance", () => {
    expect(reseatTarget([1, 2, 3], [0, 0, -2], 4)).toEqual([1, 2, -1]);
    // unknown or degenerate distance: 1 m
    expect(reseatTarget([0, 0, 0], [1, 0, 0], 0)).toEqual([1, 0, 0]);
    expect(reseatTarget([0, 0, 0], [1, 0, 0], NaN)).toEqual([1, 0, 0]);
  });
  it("drops OrbitControls' pending motion", () => {
    const c = new OrbitControls(new PerspectiveCamera(), document.createElement("div"));
    c._sphericalDelta.set(1, 0.2, 0.3);
    c._panOffset.set(1, 2, 3);
    c._scale = 1.5;
    resetOrbitMotion(c);
    expect([c._sphericalDelta.phi, c._sphericalDelta.theta]).toEqual([0, 0]);
    expect(c._panOffset.toArray()).toEqual([0, 0, 0]);
    expect(c._scale).toBe(1);
    c.dispose();
    expect(() => resetOrbitMotion({})).not.toThrow();
    expect(() => resetOrbitMotion(null)).not.toThrow();
  });
});

describe("depth range", () => {
  it("keeps near halfway to the scene, no closer than dist / 2000; a holder's planes win", () => {
    expect(depthRange({ dist: 10, radius: 1, clear: 4 })).toEqual({ near: 2, far: 1000 });
    expect(depthRange({ dist: 10, radius: 1, clear: 0 }).near).toBeCloseTo(0.005);
    expect(depthRange({ dist: 1, radius: 100, clear: 0 }).far).toBe(2001);
    expect(depthRange({ dist: 10, radius: 1, clear: 4, held: { near: 0.1 } })).toEqual({ near: 0.1, far: 1000 });
    expect(depthRange({ dist: 10, radius: 1, clear: 4, held: { far: 50 } })).toEqual({ near: 2, far: 50 });
  });
});

describe("content extras", () => {
  it("carry the GLB scene's own extras, its connectors, snap radius and raw legend", async () => {
    const tri = [0, 0, 0, 1, 0, 0, 0, 0, 1];
    const glb = encodeGLB({
      meshes: [{ positions: tri }],
      nodes: [{ mesh: 0, extras: { snapPoints: [[0, 0, 0], [2, 0, 0]] } }],
      extras: { seats: 4, connectors: "raw, replaced", legend: "raw scene legend" },
    });
    const prepared = await prepareGLB(glb);
    expect(prepared.extras.seats).toBe(4);
    const x = contentExtras(prepared);
    expect(x.seats).toBe(4);
    expect(x.connectors.map((p) => p.position)).toEqual([[0, 0, 0], [2, 0, 0]]);
    expect(x.snapRadius).toBe(defaultSnapRadius(x.connectors)); // none given: from the connectors' spacing
    expect(x.snapRadius).toBeGreaterThan(0);
    expect(Object.isFrozen(x)).toBe(true);
  });
  it("are empty-handed without connectors", () => {
    expect(contentExtras({ snap: { points: [], radius: null }, legend: null })).toEqual({ connectors: [], snapRadius: null, legend: null });
    expect(contentExtras({ snap: { points: [{ position: [0, 0, 0] }], radius: 0.3 }, legend: { min: 0 } })).toMatchObject({ snapRadius: 0.3, legend: { min: 0 } });
  });
});

describe("toBox3", () => {
  it("takes a Box3 or { min, max }", () => {
    const b = new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1));
    expect(toBox3(b)).toBe(b);
    expect(toBox3({ min: [0, 1, 2], max: [3, 4, 5] }).max.toArray()).toEqual([3, 4, 5]);
    expect(toBox3({ min: [0, 0] })).toBe(null);
    expect(toBox3(null)).toBe(null);
  });
});

describe("Viewport without WebGL", () => {
  it("says so, and everything is a harmless no-op", () => {
    const port = document.createElement("div");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {}); // three logs the failed context
    const vp = new Viewport({ port, themeRoot: port });
    quiet.mockRestore();
    expect(vp.ok).toBe(false);
    expect(vp.error).toBeTruthy();
    expect(vp.pick(1, 1)).toBe(null);
    expect(vp.ray(1, 1)).toBe(null);
    expect(vp.raycast([0, 0, 0], [0, 0, 1])).toBe(null);
    expect(vp.project([0, 0, 0])).toBe(null);
    expect(vp.pickWidget(1, 1)).toBe(null);
    expect(vp.getCamera()).toBe(null);
    expect(vp.worldOf("a")).toBe(null);
    const release = vp.hold();
    expect(() => release()).not.toThrow();
    const off = vp.limit({ maxPolar: 1 });
    expect(() => off()).not.toThrow();
    // labels still take a sync
    vp.labels.sync("x", [{ key: "a", text: "a", position: [0, 0, 0] }]);
    expect(port.querySelectorAll(".label")).toHaveLength(1);
    vp.dispose();
    expect(port.querySelector(".labels")).toBe(null);
  });
});

describe("the camera rig", () => {
  it("holds: the orbit is off; the last release re-seats the target ahead at the old distance", () => {
    const vp = headless();
    lookFrom(vp, [0, 0, 10]);
    const a = vp.hold();
    const b = vp.hold();
    expect(vp.controls.enabled).toBe(false);
    expect(vp.held).toBe(true);
    // the holder turns the camera to look down -X from elsewhere
    vp.setCamera({ position: [5, 1, 0], quaternion: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] });
    expect(r6(vp.getCamera().target)).toEqual([-5, 1, 0]);
    a();
    a(); // twice is once
    expect(vp.held).toBe(true);
    b();
    expect(vp.held).toBe(false);
    expect(vp.controls.enabled).toBe(true);
    expect(r6(vp.controls.target.toArray())).toEqual([-5, 1, 0]);
    expect(r6(vp.camera.position.toArray())).toEqual([5, 1, 0]);
  });

  it("while held, a target sets the distance the release uses, and near / far are the holder's", () => {
    const vp = headless();
    lookFrom(vp, [0, 0, 10]);
    const release = vp.hold();
    vp.setCamera({ position: [0, 0, 3], target: [0, 0, 1], near: 0.05, far: 80 });
    expect(vp.heldDepth).toEqual({ near: 0.05, far: 80 });
    expect(vp.focusDistance()).toBeCloseTo(2);
    release();
    expect(vp.heldDepth).toBe(null);
    expect(r6(vp.controls.target.toArray())).toEqual([0, 0, 1]);
    // not held: near / far aren't the caller's
    vp.setCamera({ near: 1 });
    expect(vp.heldDepth).toBe(null);
  });

  it("sets position, target, quaternion and fov; fov changes are watched", () => {
    const vp = headless();
    const watch = vi.fn();
    const off = vp.watchCamera(watch);
    vp.setCamera({ position: [0, 5, 0.0001], target: [0, 0, 0] });
    expect(r6(vp.getCamera().target)).toEqual([0, 0, 0]);
    expect(watch).not.toHaveBeenCalled();
    vp.setCamera({ fov: 60 });
    expect(vp.camera.fov).toBe(60);
    expect(watch).toHaveBeenCalledOnce();
    expect(watch.mock.calls[0][0].fov).toBe(60);
    off();
    vp.setCamera({ fov: 30 });
    expect(watch).toHaveBeenCalledOnce();
    // a quaternion alone, orbiting: the target moves in front, as far as it was
    vp.setCamera({ position: [0, 0, 4], target: [0, 0, 0] });
    vp.setCamera({ quaternion: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] });
    expect(r6(vp.controls.target.toArray())).toEqual([-4, 0, 4]);
  });

  it("frames a box from the current direction, with arrays or a Box3", () => {
    const vp = headless();
    lookFrom(vp, [0, 0, 10]);
    vp.frame({ min: [9, -1, -1], max: [11, 1, 1] });
    expect(r6(vp.controls.target.toArray())).toEqual([10, 0, 0]);
    const p = vp.camera.position;
    expect(p.x).toBeCloseTo(10);
    expect(p.z).toBeGreaterThan(1);
    // while held it frames too, and the release orbits about the box
    const release = vp.hold();
    vp.frame(new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)));
    release();
    expect(r6(vp.controls.target.toArray())).toEqual([0, 0, 0]);
  });

  it("limits intersect onto the orbit and off recomputes", () => {
    const vp = headless();
    const a = vp.limit({ maxPolar: 1.4, minDistance: 1 });
    const b = vp.limit({ maxPolar: 1.2, maxDistance: 20 });
    expect(vp.controls.maxPolarAngle).toBe(1.2);
    expect(vp.controls.minDistance).toBe(1);
    expect(vp.controls.maxDistance).toBe(20);
    b();
    expect(vp.controls.maxPolarAngle).toBe(1.4);
    expect(vp.controls.maxDistance).toBe(Infinity);
    a();
    expect(vp.controls.maxPolarAngle).toBe(Math.PI);
  });

  it("reports the end of an orbit (never while held), and whether anyone touched it", () => {
    const vp = headless();
    const end = vi.fn();
    vp.onCameraEnd(end);
    expect(vp.touched()).toBe(false);
    vp.controls.dispatchEvent({ type: "start" });
    vp.controls.dispatchEvent({ type: "end" });
    expect(vp.touched()).toBe(true);
    expect(end).toHaveBeenCalledOnce();
    expect(end.mock.calls[0][0]).toHaveProperty("position");
    const release = vp.hold();
    vp.controls.dispatchEvent({ type: "end" });
    expect(end).toHaveBeenCalledOnce();
    release();
  });
});

describe("picking", () => {
  it("picks the nearest shown object in port px, with a normal facing the eye", () => {
    const vp = headless();
    cube(vp, "near", [0, 0, 2]);
    cube(vp, "far", [0, 0, -2]);
    lookFrom(vp, [0, 0, 10]);
    const hit = vp.pick(100, 50);
    expect(hit.id).toBe("near");
    expect(hit.point[2]).toBeCloseTo(2.5);
    expect(r6(hit.normal)).toEqual([0, 0, 1]);
    expect(hit.distance).toBeCloseTo(7.5);
    expect(hit.snapped).toBe(false);
    // hidden: skipped
    vp.applyDisplay("near", { visible: false, transform: { position: [0, 0, 2] } });
    expect(vp.pick(100, 50).id).toBe("far");
    // nothing there; the ground if asked
    expect(vp.pick(100, 0)).toBe(null);
  });

  it("snaps to a vertex within snapPx when asked", () => {
    const vp = headless();
    cube(vp, "c", [0, 0, 0]);
    lookFrom(vp, [0, 0, 10]);
    const corner = vp.project([0.5, 0.5, 0.5]);
    // just outside the front corner (the back one projects a few px inward of it)
    const hit = vp.pick(corner.x + 1, corner.y - 1, { snapPx: 6 });
    expect(hit.snapped).toBe(true);
    expect(r6(hit.point)).toEqual([0.5, 0.5, 0.5]);
    expect(vp.pick(corner.x - 3, corner.y + 3).snapped).toBe(false);
  });

  it("falls to the ground plane when asked", () => {
    const vp = headless();
    lookFrom(vp, [0, 5, 5]);
    const hit = vp.pick(100, 50, { ground: true });
    expect(hit).toMatchObject({ id: null, ground: true, normal: [0, 1, 0] });
    expect(r6(hit.point)).toEqual([0, 0, 0]);
  });

  it("rays and projects in port px", () => {
    const vp = headless();
    lookFrom(vp, [0, 0, 10]);
    const r = vp.centerRay();
    expect(r6(r.origin)).toEqual([0, 0, 10]);
    expect(r6(r.dir)).toEqual([0, 0, -1]);
    expect(vp.project([0, 0, 0])).toMatchObject({ x: 100, y: 50, visible: true });
    expect(vp.project(new Vector3(0, 0, 20)).visible).toBe(false); // behind
    expect(vp.project([1000, 0, 0]).visible).toBe(false); // off the port
  });

  it("raycasts along any world ray, skipping and stopping short when asked", () => {
    const vp = headless();
    cube(vp, "a", [0, 0, 0]);
    cube(vp, "b", [3, 0, 0]);
    const hit = vp.raycast([-5, 0, 0], [2, 0, 0]);
    expect(hit.id).toBe("a");
    expect(hit.distance).toBeCloseTo(4.5);
    expect(r6(hit.normal)).toEqual([-1, 0, 0]);
    expect(vp.raycast([-5, 0, 0], [1, 0, 0], { skip: (id) => id === "a" }).id).toBe("b");
    expect(vp.raycast([-5, 0, 0], [1, 0, 0], { far: 4 })).toBe(null);
    expect(vp.raycast([-5, 0, 0], [0, 0, 0])).toBe(null);
  });
});

describe("widget layers", () => {
  const ball = (z, data = {}) => {
    const m = new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
    m.position.z = z;
    Object.assign(m.userData, data);
    return m;
  };

  it("picks the nearest widget, an onTop one over any other", () => {
    const vp = headless();
    lookFrom(vp, [0, 0, 10]);
    const near = vp.worldLayer("gizmo");
    near.add(ball(3, { axis: "x" }));
    expect(vp.pickWidget(100, 50)).toMatchObject({ owner: "gizmo", onTop: false, userData: { axis: "x" } });
    const top = vp.worldLayer("handles", { onTop: true });
    const holder = new Group();
    holder.userData.param = "length";
    holder.add(ball(-3, { knob: true }));
    top.add(holder);
    expect(top.parent).toBe(vp.topScene);
    const w = vp.pickWidget(100, 50);
    expect(w).toMatchObject({ owner: "handles", onTop: true, userData: { param: "length", knob: true } });
    expect(w.distance).toBeCloseTo(12.9);
    expect(vp.pickWidget(0, 0)).toBe(null);
  });

  it("never picks noPick subtrees or hidden ones", () => {
    const vp = headless();
    lookFrom(vp, [0, 0, 10]);
    const g = vp.worldLayer("x");
    const inert = new Group();
    inert.userData.noPick = true;
    inert.add(ball(0));
    g.add(inert);
    expect(vp.pickWidget(100, 50)).toBe(null);
    const hidden = ball(1);
    hidden.visible = false;
    g.add(hidden);
    expect(vp.pickWidget(100, 50)).toBe(null);
    const shown = ball(2);
    g.add(shown);
    expect(vp.pickWidget(100, 50).object).toBe(shown);
    g.visible = false;
    expect(vp.pickWidget(100, 50)).toBe(null);
  });

  it("removes and disposes an owner's groups, and only its", () => {
    const vp = headless();
    const a = vp.worldLayer("a");
    const a2 = vp.worldLayer("a", { onTop: true });
    const b = vp.worldLayer("b");
    const m = ball(0);
    const dispose = vi.spyOn(m.geometry, "dispose");
    const mat = vi.spyOn(m.material, "dispose");
    a.add(m);
    vp.removeLayers("a");
    expect(a.parent).toBe(null);
    expect(a2.parent).toBe(null);
    expect(b.parent).toBe(vp.widgets);
    expect(dispose).toHaveBeenCalled();
    expect(mat).toHaveBeenCalled();
    expect(vp.layers.has("a")).toBe(false);
  });
});

describe("poses", () => {
  it("a held pose beats the doc's transform until it's let go", () => {
    const vp = headless();
    vp.applyDisplay("p", { transform: { position: [1, 0, 0] } });
    vp.setPose("p", { position: [0, 2, 0], rotation: [0, 0, 0], scale: 1 });
    expect(vp.worldOf("p").slice(12, 15)).toEqual([0, 2, 0]);
    // the doc changing underneath doesn't move it
    vp.applyDisplay("p", { transform: { position: [5, 0, 0] } });
    expect(vp.worldOf("p").slice(12, 15)).toEqual([0, 2, 0]);
    vp.setPose("p", null);
    expect(vp.worldOf("p").slice(12, 15)).toEqual([5, 0, 0]);
    expect(vp.worldOf("missing")).toBe(null);
  });

  it("composes with the parent, and applies to an object that arrives later", () => {
    const vp = headless();
    vp.applyDisplay("parent", { transform: { position: [10, 0, 0], scale: 2 } });
    vp.setPose("child", { position: [1, 0, 0] });
    vp.applyDisplay("child", { transform: { position: [0, 0, 0] } }, "parent");
    const m = vp.worldOf("child");
    expect(m).toHaveLength(16);
    expect(m.slice(12, 15)).toEqual([12, 0, 0]);
    expect(m[0]).toBe(2);
  });
});

describe("content and depth", () => {
  it("contentOf: body-space box (the hint until it loads), extras, root", () => {
    const vp = headless();
    vp.setHint("h", { min: [0, 0, 0], max: [1, 2, 3] });
    expect(vp.contentOf("h")).toEqual({ loaded: false, box: { min: [0, 0, 0], max: [1, 2, 3] }, extras: null, stats: null, root: null });
    const entry = cube(vp, "c", [5, 0, 0]);
    entry.extras = contentExtras({ snap: { points: [], radius: null } });
    const c = vp.contentOf("c");
    expect(c.loaded).toBe(true);
    expect(c.box).toEqual({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }); // body space, not moved to x = 5
    expect(c.extras.connectors).toEqual([]);
    expect(c.root).toBe(entry.content);
    expect(vp.contentOf("nope")).toBe(null);
  });

  it("the depth box is the shown content plus every extent, recomputed only when marked", () => {
    const vp = headless();
    cube(vp, "c", [0, 0, 0]);
    vp.updateDepth();
    const contentOnly = vp.depthBox.clone();
    expect(contentOnly.max.x).toBeCloseTo(0.55);
    vp.setExtent("grid", { min: [-10, 0, -10], max: [10, 0, 10] });
    expect(vp.depthDirty).toBe(true);
    vp.updateDepth();
    expect(vp.depthBox.min.x).toBe(-10);
    expect(vp.sceneRadius).toBeGreaterThan(10);
    vp.setExtent("grid", null);
    vp.updateDepth();
    expect(vp.depthBox.equals(contentOnly)).toBe(true);
    vp.applyDisplay("c", { visible: false });
    vp.updateDepth();
    expect(vp.depthBox).toBe(null);
    expect(vp.sceneRadius).toBe(1);
  });

  it("frame hooks and loops register and come off", () => {
    const vp = headless();
    const loop = vi.fn();
    const off = vp.addLoop(loop);
    expect(vp.loops.size).toBe(1);
    off();
    expect(vp.loops.size).toBe(0);
    const offAfter = vp.afterRender(() => {});
    expect(vp.afterHooks.size).toBe(1);
    offAfter();
    expect(vp.afterHooks.size).toBe(0);
  });

  it("tells theme listeners about a new set of tokens", () => {
    const vp = headless();
    const fn = vi.fn();
    const off = vp.onTheme(fn);
    const before = vp.theme;
    vp.applyTheme();
    expect(fn).toHaveBeenCalledOnce();
    expect(fn.mock.calls[0][0]).toBe(vp.theme);
    expect(vp.theme).not.toBe(before);
    expect(vp.theme.accent).toHaveLength(3);
    off();
    vp.applyTheme();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("atmosphere", () => {
  /** What the lights, fog and sky are, as plain values. */
  const rig = (vp) => ({
    hemi: [vp.hemi.intensity, vp.hemi.color.getHex(), vp.hemi.groundColor.getHex()],
    key: [vp.keyLight.intensity, vp.keyLight.color.getHex(), r6(vp.keyLight.position.toArray()), r6(vp.keyLight.target.position.toArray()), vp.keyLight.castShadow],
    headlight: vp.headlight.intensity,
    environment: vp.scene.environmentIntensity,
    fog: vp.scene.fog,
    sky: !!vp.sky?.visible,
    shadows: vp.shadows,
  });

  it("cleans what it's given: colours checked, numbers finite, a unit sun; nothing usable is null", () => {
    expect(cleanAtmosphere(null)).toBeNull();
    expect(cleanAtmosphere({ sky: { top: "blue" }, fog: { color: "#fff", near: 5, far: 2 }, exposure: -1 })).toBeNull();
    const a = cleanAtmosphere({ sky: { top: "#336699", bottom: 0x102030 }, fog: { far: 80 }, sun: { direction: [0, 3, 4], intensity: "2", shadows: 1 }, exposure: 0.5 });
    expect(a.sky).toEqual({ top: "#336699", horizon: "#336699", bottom: "#102030" });
    // fog without a colour takes the horizon's
    expect(a.fog).toEqual({ color: "#336699", near: 0, far: 80 });
    expect(a.sun).toEqual({ direction: [0, 0.6, 0.8], color: "#ffffff", intensity: 2, shadows: false });
    expect(a.exposure).toBe(0.5);
    // a sun with no direction stands where the key light does
    const k = Math.hypot(...LIGHTS.keyFrom);
    expect(cleanAtmosphere({ sun: {} }).sun.direction).toEqual(LIGHTS.keyFrom.map((v) => v / k));
  });

  it("no atmosphere is the stage's own lighting, exactly", () => {
    expect(lighting(null)).toEqual({
      hemisphere: { intensity: LIGHTS.hemisphere, sky: "#ffffff", ground: "#3a3a3a" },
      key: { intensity: LIGHTS.key, color: "#ffffff", from: [...LIGHTS.keyFrom], shadows: false },
      headlight: LIGHTS.headlight,
      environment: LIGHTS.environment,
    });
    const vp = headless();
    const before = rig(vp);
    expect(before).toMatchObject({ hemi: [LIGHTS.hemisphere, 0xffffff, 0x3a3a3a], key: [LIGHTS.key, 0xffffff, LIGHTS.keyFrom, [0, 0, 0], false], headlight: LIGHTS.headlight, fog: null, sky: false, shadows: false });
    // nothing to say changes nothing
    vp.setAtmosphere(null);
    vp.setAtmosphere({ weather: "rain" });
    expect(rig(vp)).toEqual(before);
    expect(vp.sky).toBeNull();
  });

  it("a sun replaces the key light, a sky tints the sky light, exposure scales them all; taken away, today's rig is back", () => {
    const vp = headless();
    const before = rig(vp);
    cube(vp, "a", [0, 0, 0], 2);
    vp.setAtmosphere({ sky: { top: "#4080c0", horizon: "#e0d0b0", bottom: "#806040" }, fog: { color: "#e0d0b0", near: 20, far: 120 }, sun: { direction: [0, 1, 0], color: "#ffeecc", intensity: 2, shadows: true }, exposure: 2 });
    expect(vp.keyLight.intensity).toBe(4);
    expect(vp.keyLight.color.getHexString()).toBe("ffeecc");
    // the headlight dims under a sun (and exposure scales it too)
    expect(vp.headlight.intensity).toBeCloseTo((LIGHTS.headlight / 3) * 2);
    expect(vp.scene.environmentIntensity).toBeCloseTo(LIGHTS.environment * 2);
    expect(vp.hemi.color.getHexString()).toBe("4080c0");
    expect(vp.scene.fog.near).toBe(20);
    expect(vp.sky.visible).toBe(true);
    // shadows: the light casts, and so does what's there
    expect(vp.keyLight.castShadow).toBe(true);
    expect(vp.objects.get("a").content.castShadow).toBe(true);
    expect(vp.objects.get("a").content.receiveShadow).toBe(true);
    // the sky is never picked and never counts toward the scene's box
    expect(vp.sceneBox().max.toArray()).toEqual([1, 1, 1]);
    vp.setCamera({ position: [0, 0, 10], target: [0, 0, 0] });
    expect(vp.pick(100, 5)).toBeNull();

    vp.setAtmosphere(null);
    expect(rig(vp)).toEqual(before);
    expect(vp.objects.get("a").content.castShadow).toBe(false);
  });

  it("the sun's shadow map covers the scene's box", () => {
    const f = sunFrame({ min: [-2, 0, -2], max: [2, 2, 2] }, [0, 1, 0], 1024);
    expect(f.target).toEqual([0, 1, 0]);
    expect(f.radius).toBeCloseTo(3);
    expect(f.position).toEqual([0, 7, 0]);
    // the whole sphere lies between near and far
    expect(f.near).toBeLessThanOrEqual(2 * f.radius - f.radius);
    expect(f.far).toBeGreaterThanOrEqual(3 * f.radius);
    expect(f.normalBias).toBeCloseTo((6 / 1024) * 1.5);
  });
});

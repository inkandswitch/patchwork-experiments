import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import * as THREE from "three";
import { mountStage, object } from "../test/stage-harness.js";
import gizmo from "./gizmo.js";
import { effectiveTool, gizmoTarget, groupMove, groupRoots, localFrom } from "./gizmo-math.js";
import { composeMatrix } from "../transform.js";
import { resolveGroups } from "../groups.js";
import { resolveParents } from "../hierarchy.js";

const GIZMO = { meta: { id: "scene.gizmo" }, module: gizmo };
const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const group = (name, extra = {}) => ({ kind: "group", name, group: null, visible: true, ...extra });

/** A snapshot like api.scene()'s, for the pure helpers. */
function snap(objects, view = {}) {
  return { d: { objects, view }, objects, parents: resolveParents(objects), groups: resolveGroups(objects) };
}

async function mount({ objects = {}, view = {}, extensions = [] } = {}) {
  const s = await mountStage({
    extensions: [GIZMO, ...extensions],
    kits: [{ id: "model", extensions: ["scene.gizmo", ...extensions.map((e) => e.meta.id)] }],
    doc: { objects, order: Object.keys(objects), view },
  });
  // no WebGL here: give the viewport a camera, looking at the origin
  const cam = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  cam.position.set(3, 4, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  s.debug.viewport.camera = cam;
  s.cam = cam;
  s.gizmo = () => s.instance("scene.gizmo");
  s.select = async (id) => {
    s.local.swap((m) => ({ ...m, selected: id }));
    await s.settle();
  };
  s.setLocal = async (k, v) => {
    s.local.swap((m) => ({ ...m, [k]: v }));
    await s.settle();
  };
  return s;
}

/** Where on screen (ndc) a point along the gizmo's X arrow is, `along` world units further out. */
function xArrow(s, along = 0) {
  const { tc, proxy } = s.gizmo().debug;
  tc.getHelper().parent.updateMatrixWorld(true);
  const factor = proxy.position.distanceTo(s.cam.position) * Math.min((1.9 * Math.tan((Math.PI * s.cam.fov) / 360)) / s.cam.zoom, 7);
  const p = proxy.position.clone().add(new THREE.Vector3((0.4 * factor) / 4 + along, 0, 0)).project(s.cam);
  return [p.x, p.y];
}

const cmd = (s, id) => s.gizmo().commands.find((c) => c.id === id);
const state = (s, id, target = null) => cmd(s, id).state(target, { scene: s.debug.scene(), local: s.local.get() });

describe("scene.gizmo: the tool", () => {
  it("reads the local tool, then the doc's suggestion, then move", () => {
    expect(effectiveTool({}, {})).toBe("move");
    expect(effectiveTool({}, { view: { defaultMode: "rotate" } })).toBe("rotate");
    expect(effectiveTool({}, { view: { defaultGizmo: "translate" } })).toBe("move");
    expect(effectiveTool({}, { view: { tool: "hand", defaultMode: "rotate" } })).toBe("hand");
    expect(effectiveTool({ tool: "select" }, { view: { defaultMode: "hand" } })).toBe("select");
  });

  it("Move, Rotate and No gizmo set local.tool, checked by the tool in effect", async () => {
    const s = await mount({ view: { defaultMode: "rotate" } });
    expect(state(s, "rotate").checked).toBe(true);
    expect(state(s, "move").checked).toBe(false);
    expect(cmd(s, "move").key).toBe("g");
    expect(cmd(s, "rotate").key).toBe("r");
    expect(cmd(s, "select").show).toEqual(["toolbar"]);
    expect(s.api("scene.gizmo").run({ ext: "scene.gizmo", command: "move", target: null })).toBe(true);
    expect(s.local.get().tool).toBe("move");
    expect(state(s, "move").checked).toBe(true);
    s.api("scene.gizmo").run({ ext: "scene.gizmo", command: "select", target: null });
    expect(s.local.get().tool).toBe("select");
    expect(state(s, "select").checked).toBe(true);
    s.unmount();
  });

  it("its commands apply only to the scene, not an object", async () => {
    const s = await mount({ objects: { a: object() } });
    expect(state(s, "move", "a")).toBeNull();
    expect(s.api("scene.gizmo").run({ ext: "scene.gizmo", command: "rotate", target: "a" })).toBe(false);
    s.unmount();
  });
});

describe("scene.gizmo: when it shows", () => {
  it("on a selected, unlocked object, for move and rotate, while nothing is armed", () => {
    const sc = snap({ a: object(), l: object({ locked: true }) });
    expect(gizmoTarget(sc, { selected: "a" })).toEqual({ kind: "object", id: "a", mode: "translate" });
    expect(gizmoTarget(sc, { selected: "a", tool: "rotate" })?.mode).toBe("rotate");
    expect(gizmoTarget(sc, { selected: "a", tool: "hand" })).toBeNull();
    expect(gizmoTarget(sc, { selected: "a", tool: "select" })).toBeNull();
    expect(gizmoTarget(sc, { selected: "a", armed: "scene.measure" })).toBeNull();
    expect(gizmoTarget(sc, { selected: "l" })).toBeNull();
    expect(gizmoTarget(sc, { selected: null })).toBeNull();
    expect(gizmoTarget(sc, { selected: "gone" })).toBeNull();
    expect(gizmoTarget(sc, { selected: "dimension:d1" })).toBeNull(); // a ref isn't an object
    expect(gizmoTarget(snap({ a: object() }, { defaultGizmo: "hand" }), { selected: "a" })).toBeNull();
  });

  it("on a group with something it can move", () => {
    const sc = snap({ g: group("G"), a: object({ group: "g" }), e: group("Empty"), h: group("Held"), l: object({ group: "h", locked: true }) });
    expect(gizmoTarget(sc, { selected: "g" })).toEqual({ kind: "group", id: "g", mode: "translate" });
    expect(gizmoTarget(sc, { selected: "e" })).toBeNull();
    expect(gizmoTarget(sc, { selected: "h" })).toBeNull();
  });

  it("attaches to the selection through the stage, and comes off for hand, arming or deselection", async () => {
    const s = await mount({ objects: { a: object({ transform: T([1, 2, 3]) }), l: object({ locked: true }) } });
    expect(s.gizmo().debug.target).toBeNull();
    await s.select("a");
    const { tc, proxy } = s.gizmo().debug;
    expect(tc.object).toBe(proxy);
    expect(tc.mode).toBe("translate");
    expect(proxy.position.toArray()).toEqual([1, 2, 3]);
    expect(tc.getHelper().userData.noPick).toBe(true);
    await s.setLocal("tool", "rotate");
    expect(tc.mode).toBe("rotate");
    await s.setLocal("tool", "hand");
    expect(tc.object).toBeUndefined();
    await s.setLocal("tool", "move");
    expect(tc.object).toBe(proxy);
    s.local.swap((m) => ({ ...m, armed: "scene.measure" }));
    await s.settle();
    expect(tc.object).toBeUndefined();
    s.local.swap((m) => ({ ...m, armed: null }));
    await s.select("l");
    expect(tc.object).toBeUndefined();
    await s.select(null);
    expect(tc.object).toBeUndefined();
    s.unmount();
  });

  it("follows the object when the doc moves it", async () => {
    const s = await mount({ objects: { a: object({ transform: T([1, 0, 0]) }) } });
    await s.select("a");
    s.change((d) => {
      d.objects.a.transform.position[1] = 5;
    });
    await s.settle();
    expect(s.gizmo().debug.proxy.position.toArray()).toEqual([1, 5, 0]);
    s.unmount();
  });
});

describe("scene.gizmo: dragging", () => {
  it("a handle under the pointer is an onTop widget; elsewhere there's none", async () => {
    const s = await mount({ objects: { a: object() } });
    await s.select("a");
    const w = s.gizmo().input.widgetAt({ ndc: xArrow(s) });
    expect(w).toEqual({ onTop: true, axis: "X" });
    expect(s.gizmo().input.widgetAt({ ndc: [0.95, 0.95] })).toBeNull();
    expect(s.gizmo().input.press({ ndc: [0.95, 0.95], button: 0 })).toBeNull();
    s.unmount();
  });

  it("moves along X: holds the pose while dragging, writes it on release", async () => {
    const s = await mount({ objects: { a: object() } });
    await s.select("a");
    const { input } = s.gizmo();
    const session = input.press({ ndc: xArrow(s), button: 0 });
    expect(session).toBeTruthy();
    expect(s.gizmo().debug.dragging).toBe(true);
    session.move({ ndc: xArrow(s, 2) });
    const held = s.debug.viewport.poses.get("a");
    expect(held.position[0]).toBeCloseTo(2, 4);
    expect(held.position[1]).toBeCloseTo(0, 6);
    expect(s.doc().objects.a.transform.position).toEqual([0, 0, 0]); // not written yet
    session.end({ ndc: xArrow(s, 2) });
    await s.settle();
    expect(s.doc().objects.a.transform.position[0]).toBeCloseTo(2, 4);
    expect(s.debug.viewport.poses.has("a")).toBe(false);
    expect(s.gizmo().debug.dragging).toBe(false);
    s.unmount();
  });

  it("a cancel (Escape) puts it back and writes nothing", async () => {
    const s = await mount({ objects: { a: object({ transform: T([1, 0, 0]) }) } });
    await s.select("a");
    const session = s.gizmo().input.press({ ndc: xArrow(s), button: 0 });
    session.move({ ndc: xArrow(s, 3) });
    expect(s.debug.viewport.poses.get("a").position[0]).toBeCloseTo(4, 4);
    session.cancel();
    await s.settle();
    expect(s.debug.viewport.poses.has("a")).toBe(false);
    expect(s.doc().objects.a.transform.position).toEqual([1, 0, 0]);
    expect(s.gizmo().debug.proxy.position.x).toBeCloseTo(1, 6);
    s.unmount();
  });

  it("writes the local transform under an attached object's parent", async () => {
    const s = await mount({
      objects: {
        p: object({ transform: T([10, 0, 0], [0, 0, Math.PI / 2], 2) }),
        a: object({ parent: "p", transform: T([1, 0, 0]) }),
      },
    });
    s.cam.position.set(13, 6, 10);
    s.cam.lookAt(10, 2, 0);
    s.cam.updateMatrixWorld(true);
    await s.select("a");
    // world: p's rotation turns a's local +X into world +Y, scaled by 2
    expect(s.gizmo().debug.proxy.position.x).toBeCloseTo(10, 6);
    expect(s.gizmo().debug.proxy.position.y).toBeCloseTo(2, 6);
    const session = s.gizmo().input.press({ ndc: xArrow(s), button: 0 });
    session.move({ ndc: xArrow(s, 4) }); // world +4 along X
    session.end({});
    await s.settle();
    const t = s.doc().objects.a.transform;
    // world +X is p's local -Y, and p's scale halves it
    expect(t.position[0]).toBeCloseTo(1, 4);
    expect(t.position[1]).toBeCloseTo(-2, 4);
    expect(t.scale).toBeCloseTo(1, 6);
    s.unmount();
  });

  it("a press on a handle claims it: a tap doesn't fall through as a click", async () => {
    const clicks = [];
    const catcher = { meta: { id: "t.click" }, module: { create: () => ({ input: { click: () => (clicks.push(1), true) } }) } };
    const s = await mount({ objects: { a: object() }, extensions: [catcher] });
    await s.select("a");
    // happy-dom's canvas has no size, so every event lands at ndc [0, 0]: point the camera so
    // the gizmo's centre handle is there
    s.cam.position.set(0, 0, 10);
    s.cam.lookAt(0, 0, 0);
    s.cam.updateMatrixWorld(true);
    expect(s.gizmo().input.widgetAt({ ndc: [0, 0] })?.axis).toBeTruthy();
    s.click(5, 5);
    expect(clicks).toEqual([]);
    expect(s.doc().objects.a.transform.position).toEqual([0, 0, 0]);
    // and away from the gizmo, the click goes on down the chain
    await s.select(null);
    s.click(5, 5);
    expect(clicks).toEqual([1]);
    s.unmount();
  });
});

describe("scene.gizmo: groups", () => {
  const objects = () => ({
    g: group("G"),
    a: object({ group: "g", transform: T([1, 0, 0]) }),
    b: object({ group: "g", transform: T([-1, 0, 0]) }),
    k: object({ group: "g", locked: true, transform: T([0, 5, 0]) }),
    c: object({ group: "g", parent: "a", transform: T([0, 1, 0]) }),
    out: object({ transform: T([9, 9, 9]) }),
  });

  it("moves its unlocked members not attached to another member", () => {
    const sc = snap(objects());
    expect(groupRoots(sc, "g").sort()).toEqual(["a", "b"]);
  });

  it("each root keeps its pose relative to the pivot", () => {
    const start = composeMatrix(T([0, 0, 0]));
    const now = composeMatrix(T([0, 0, 0], [0, 0, Math.PI / 2]));
    const moved = groupMove(start, now, [
      { id: "a", world: composeMatrix(T([1, 0, 0])), parentWorld: null },
      { id: "q", world: composeMatrix(T([1, 0, 0])), parentWorld: composeMatrix(T([0, 0, 3])) },
    ]);
    expect(moved.get("a").position[0]).toBeCloseTo(0, 9);
    expect(moved.get("a").position[1]).toBeCloseTo(1, 9);
    expect(moved.get("a").rotation[2]).toBeCloseTo(Math.PI / 2, 9);
    expect(moved.get("q").position).toEqual([0, 1, -3]);
    expect(localFrom(composeMatrix(T([1, 1, 1], [0, 0, 0], 2)), composeMatrix(T([3, 1, 1]))).position).toEqual([1, 0, 0]);
  });

  it("drags the group from a pivot at its centre, writing every moved member in one change", async () => {
    const s = await mount({ objects: objects() });
    // no WebGL here, so no boxes: give the group one
    s.api("scene.gizmo").groupBox = (id) => (id === "g" ? { min: [-2, -1, -1], max: [2, 1, 1] } : null);
    await s.select("g");
    const { tc, proxy, target } = s.gizmo().debug;
    expect(target).toEqual({ kind: "group", id: "g", mode: "translate" });
    expect(tc.object).toBe(proxy);
    expect(proxy.position.toArray()).toEqual([0, 0, 0]);
    let changes = 0;
    s.handle.on?.("change", () => changes++);
    const before = changes;
    const session = s.gizmo().input.press({ ndc: xArrow(s), button: 0 });
    session.move({ ndc: xArrow(s, 1.5) });
    expect(s.debug.viewport.poses.get("a").position[0]).toBeCloseTo(2.5, 4);
    expect(s.debug.viewport.poses.get("b").position[0]).toBeCloseTo(0.5, 4);
    expect(s.debug.viewport.poses.has("k")).toBe(false); // locked
    expect(s.debug.viewport.poses.has("c")).toBe(false); // follows a
    session.end({});
    await s.settle();
    const d = s.doc().objects;
    expect(d.a.transform.position[0]).toBeCloseTo(2.5, 4);
    expect(d.b.transform.position[0]).toBeCloseTo(0.5, 4);
    expect(d.k.transform.position).toEqual([0, 5, 0]);
    expect(d.c.transform.position).toEqual([0, 1, 0]);
    expect(d.out.transform.position).toEqual([9, 9, 9]);
    if (s.handle.on) expect(changes - before).toBe(1);
    expect(s.debug.viewport.poses.size).toBe(0);
    s.unmount();
  });
});

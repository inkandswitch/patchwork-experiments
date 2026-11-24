// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, posesBy, settle } from "../test/stage-harness.js";
import halo from "./halo.js";
import { GRAB_PX, MIN_SCALE, MOVE, dragDelta, groupMembers, groupRoots, haloHandles, haloTarget, handleAt, handlePoints, usable } from "./halo-math.js";
import { applyMatrix, composeMatrix, decomposeMatrix, multiplyMatrices } from "../transform.js";
import { resolveGroups } from "../groups.js";
import { resolveParents } from "../hierarchy.js";

const HALO = { meta: { id: "scene.halo" }, module: halo };
const T = (position, rotation = [0, 0, 0], scale = 1) => ({ position, rotation, scale });
const group = (name, extra = {}) => ({ kind: "group", name, group: null, visible: true, ...extra });
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

/** A snapshot like api.scene()'s, for the pure helpers. */
function snap(objects) {
  return { d: { objects }, objects, parents: resolveParents(objects), groups: resolveGroups(objects) };
}

// ─── the pure parts ─────────────────────────────────────────────────────────

describe("haloTarget: what the handles are on", () => {
  const sc = snap({
    a: object(),
    l: object({ locked: true }),
    g: group("G"),
    m: object({ group: "g" }),
    e: group("Empty"),
    lg: group("Locked"),
    lm: object({ group: "lg", locked: true }),
  });
  // (Move and Measure are the editor's tools: held only while the editor is, H14, so no stack holds them without it)
  it("every body × the editor held or not × selection × the tools held (none, Move, a pointing one, one that only looks, and their stacks) × writable: only holding Move, and no other pointing tool", () => {
    const want = { a: { kind: "object", id: "a" }, g: { kind: "group", id: "g" }, m: { kind: "object", id: "m" } };
    const MOVING = { ...MOVE, pointer: false };
    const MEASURE = { ext: "scene.measure", command: "measure", pointer: true };
    const XRAY = { ext: "scene.xray", command: "xray", pointer: false };
    const stacks = [[], [MOVING], [MEASURE], [XRAY], [MEASURE, XRAY], [XRAY, MEASURE], [MOVING, MEASURE], [MEASURE, MOVING], [MOVING, XRAY], [XRAY, MOVING]];
    for (const body of ["look", "walk", "seat", "station", undefined])
      for (const edit of [false, true])
        for (const selected of [null, "a", "l", "g", "m", "e", "lg", "lm", "gone", "dimension:x"])
          for (const held of stacks.filter((h) => edit || !h.some((t) => t === MOVING || t === MEASURE)))
            for (const writable of [true, false]) {
              const hands = [...(edit ? [{ kind: "edit" }] : []), ...held.map(() => ({ kind: "tool" }))];
              const got = haloTarget(sc, { body: body ? { id: body } : undefined, hands, selected, held }, writable);
              const shows = writable && held.includes(MOVING) && !held.includes(MEASURE);
              expect([body, edit, selected, held, writable, got]).toEqual([body, edit, selected, held, writable, shows ? (want[selected] ?? null) : null]);
            }
  });
});

describe("groups: what a group's handles move", () => {
  const sc = snap({
    g: group("G"),
    inner: group("Inner", { group: "g" }),
    a: object({ group: "g" }),
    b: object({ group: "inner" }),
    kid: object({ group: "g", parent: "a" }),
    l: object({ group: "g", locked: true }),
    out: object(),
  });
  it("members at any depth; roots are the unlocked ones not attached to another member", () => {
    expect(groupMembers(sc, "g").sort()).toEqual(["a", "b", "kid", "l"]);
    expect(groupRoots(sc, "g").sort()).toEqual(["a", "b"]);
    expect(groupRoots(sc, "inner")).toEqual(["b"]);
  });
});

// boxes of every shape the halo meets: a cube, a slab, a card (no height), a
// stick, a point, off the origin
const BOXES = [
  { min: [-1, -1, -1], max: [1, 1, 1] },
  { min: [0, 0, 0], max: [2, 0.2, 1] },
  { min: [-0.03, 0, -0.045], max: [0.03, 0, 0.045] },
  { min: [5, 5, 5], max: [5, 9, 5] },
  { min: [1, 2, 3], max: [1, 2, 3] },
];
const SIZES = [1e-3, 0.05, 0.3, 4];
const distToBox = (p, b) => Math.hypot(...[0, 1, 2].map((k) => Math.max(b.min[k] - p[k], 0, p[k] - b.max[k])));

describe("haloHandles: where they go", () => {
  it("3 arrows, 3 rings and 8 corners, every point at least a handle's size outside the box: every box × size", () => {
    for (const box of BOXES)
      for (const size of SIZES) {
        const { handles } = haloHandles(box, size);
        expect(handles.map((h) => h.kind)).toEqual(["move", "move", "move", "rotate", "rotate", "rotate", ...Array(8).fill("scale")]);
        for (const h of handles)
          for (const p of handlePoints(h)) {
            const d = distToBox(p, box);
            expect([box, size, h.kind, d >= size * (1 - 1e-9)]).toEqual([box, size, h.kind, true]);
          }
      }
  });
  it("rings clear the corners and the arrows clear the rings", () => {
    for (const box of BOXES)
      for (const size of SIZES) {
        const { handles, center, radius } = haloHandles(box, size);
        const corners = handles.filter((h) => h.kind === "scale");
        for (const c of corners) expect(Math.hypot(...[0, 1, 2].map((k) => c.at[k] - center[k]))).toBeLessThan(radius - size / 2);
        for (const a of handles.filter((h) => h.kind === "move")) expect(Math.hypot(...[0, 1, 2].map((k) => a.from[k] - center[k]))).toBeCloseTo(radius + size, 9);
      }
  });
});

describe("handleAt: which handle the pointer is on", () => {
  // looking down -Z: a frame point (x, y, z) is at port (100 + 10x, 100 − 10y)
  const project = (p) => ({ x: 100 + p[0] * 10, y: 100 - p[1] * 10, visible: true });
  const eye = [0, 0, 10];
  const { handles } = haloHandles({ min: [-1, -1, -1], max: [1, 1, 1] }, 0.3);
  it("the X arrow, the nearer of two corners, the Z ring; nothing inside the box's own outline", () => {
    const x = handles.find((h) => h.kind === "move" && h.axis === 0);
    const sx = project(x.from);
    expect(handleAt(handles, project, { x: sx.x + 3, y: sx.y }, { eye })?.handle).toBe(x);
    const corner = handles.find((h) => h.kind === "scale" && h.corner === 7);
    const sc = project(corner.at);
    expect(handleAt(handles, project, sc, { eye })?.handle).toBe(corner); // corner 3 is behind it
    const ring = handles.find((h) => h.kind === "rotate" && h.axis === 2);
    const r = project([ring.center[0] + ring.radius * Math.cos(2), ring.center[1] + ring.radius * Math.sin(2), 0]);
    expect(handleAt(handles, project, r, { eye })?.handle).toBe(ring);
    // the box's middle on screen: the rings about X and Y are edge on, so nothing of the halo is within reach
    expect(handleAt(handles, project, { x: 100, y: 100 }, { eye })).toBe(null);
    expect(handleAt(handles, project, { x: sx.x + 15, y: sx.y + GRAB_PX + 1 }, { eye })).toBe(null); // past its tip, below it
  });
  it("usable: no arrow seen end on, no ring seen edge on: every handle from each axis's eye", () => {
    for (let k = 0; k < 3; k++) {
      const e = [0, 0, 0];
      e[k] = 10;
      const live = handles.filter((h) => usable(h, e)).map((h) => `${h.kind}${h.axis ?? h.corner}`);
      const want = handles.filter((h) => h.kind === "scale" || (h.kind === "move" && h.axis !== k) || (h.kind === "rotate" && h.axis === k)).map((h) => `${h.kind}${h.axis ?? h.corner}`);
      expect(live).toEqual(want);
    }
  });
});

describe("dragDelta: what a drag does", () => {
  const box = { min: [-1, -1, -1], max: [1, 1, 1] };
  const { handles, center } = haloHandles(box, 0.3);
  const down = (x, y) => ({ origin: [x, y, 10], dir: [0, 0, -1] });
  const grabOf = (h, point) => ({ handle: h, point, center });
  it("a move arrow moves along its axis by how far along it the pointer went", () => {
    const x = handles.find((h) => h.kind === "move" && h.axis === 0);
    for (const dx of [-2, -0.5, 0, 0.25, 3]) {
      const D = dragDelta(grabOf(x, x.from), down(x.from[0], x.from[1]), down(x.from[0] + dx, x.from[1] + 7));
      expect(near(D, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, 0, 0, 1])).toBe(true);
    }
    // the Z arrow seen end on: the ray says nothing about it
    const z = handles.find((h) => h.kind === "move" && h.axis === 2);
    expect(dragDelta(grabOf(z, z.from), down(0, 0), down(1, 1))).toBe(null);
  });
  it("a ring turns about its axis through the box's centre by the angle swept", () => {
    const ring = handles.find((h) => h.kind === "rotate" && h.axis === 2);
    const at = (a) => [ring.radius * Math.cos(a), ring.radius * Math.sin(a)];
    for (const [a0, a1] of [[0, Math.PI / 2], [1, 0.5], [3, -3]]) {
      const D = dragDelta(grabOf(ring, [...at(a0), 0]), down(...at(a0)), down(...at(a1)));
      const turned = applyMatrix(D, [1, 0, 0]);
      const da = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
      expect(near(turned, [Math.cos(da), Math.sin(da), 0], 1e-9)).toBe(true);
      expect(near(applyMatrix(D, center), center)).toBe(true);
    }
    // a ring seen edge on: nothing
    const xr = handles.find((h) => h.kind === "rotate" && h.axis === 0);
    expect(dragDelta(grabOf(xr, [0, ring.radius, 0]), down(0, ring.radius), down(0, 0))).toBe(null);
  });
  it("a corner scales about the centre by how much further out the pointer is, never below MIN_SCALE", () => {
    const corner = handles.find((h) => h.kind === "scale" && h.corner === 7);
    for (const k of [0.5, 1, 2]) {
      const D = dragDelta(grabOf(corner, corner.at), down(corner.at[0], corner.at[1]), down(corner.at[0] * k, corner.at[1] * k));
      expect(near(applyMatrix(D, center), center)).toBe(true);
      expect(decomposeMatrix(D).scale).toBeCloseTo(k, 9);
    }
    const D = dragDelta(grabOf(corner, corner.at), down(corner.at[0], corner.at[1]), down(0, 0));
    expect(decomposeMatrix(D).scale).toBeCloseTo(MIN_SCALE, 9);
  });
});

// ─── on the stage ───────────────────────────────────────────────────────────

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

const CUBE = { min: [-1, -1, -1], max: [1, 1, 1] };

/**
 * Mount the halo with a fake camera looking down −Z from (0, 0, 10): a world
 * point (x, y, z) is at port (100 + 10x, 100 − 10y), the ray through a port
 * point runs down −Z, and every object's content is a 2 m cube about its
 * origin. `worlds` overrides an object's drawn world matrix (a moving parent).
 */
async function mount({ objects = {}, extensions = [], readOnly = false } = {}) {
  const poses = { heldBy: () => null };
  s = await mountStage({ editor: true, natives: true,  extensions: [HALO, posesBy(poses), ...extensions], doc: { objects, order: Object.keys(objects) } });
  s.poses = poses;
  if (readOnly) s.handle.isReadOnly = () => true;
  const vp = s.debug.viewport;
  vp.project = (p) => ({ x: 100 + p[0] * 10, y: 100 - p[1] * 10, visible: true });
  vp.ray = (x, y) => ({ origin: [(x - 100) / 10, (100 - y) / 10, 10], dir: [0, 0, -1] });
  vp.getCamera = () => ({ position: [0, 0, 10], target: [0, 0, 0], fov: 45 });
  vp.contentOf = (id) => (s.doc().objects[id] && s.doc().objects[id].kind !== "group" ? { loaded: true, box: CUBE, extras: null, stats: null, root: null } : null);
  const api = s.facet("scene.halo");
  s.worlds = new Map();
  api.worldOf = (id) => s.worlds.get(id) ?? s.debug.scene().world(id);
  const objectBox = api.box;
  api.box = (gid, o) => {
    if (s.debug.scene().objects[gid]?.kind !== "group") return objectBox(gid, o);
    const ids = groupMembers(s.debug.scene(), gid);
    const pts = ids.flatMap((id) => [applyMatrix(api.worldOf(id), CUBE.min), applyMatrix(api.worldOf(id), CUBE.max)]);
    return pts.length ? { min: [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))), max: [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) } : null;
  };
  s.holds = [];
  s.releases = [];
  // `s.refuse`: ids something here holds ahead of the halo (holds.js), whose holds don't stand
  s.refuse = new Set();
  poses.hold = (id, t) => (s.holds.push([id, t]), !s.refuse.has(id));
  poses.release = (id, o) => s.releases.push([id, o ?? {}]);
  s.halo = () => s.instance("scene.halo");
  // the handles are Move's: pick it up, as V does
  s.move = async (on = true) => {
    const held = s.debug.view.atom.get().held.some((t) => t.command === MOVE.command);
    if (held !== on) s.debug.view.plugins.record("scene.halo").api.run({ ext: "scene.halo", command: MOVE.command, target: null });
    await settle();
  };
  await s.move(true);
  s.select = async (id) => {
    s.local.swap((m) => ({ ...m, selected: id }));
    await settle();
  };
  return s;
}

const handle = (kind, axis) => s.halo().debug.handles.find((h) => h.kind === kind && (axis == null || h.axis === axis));
/** The port point of a frame point of the halo's (its frame's conversions, then the fake camera). */
const portOf = (p) => s.debug.viewport.project(s.halo().debug.frame.pointOut(p));
const ev = (type, x, y, extra = {}) => ({ type, x, y, button: 0, ray: s.debug.viewport.ray(x, y), ...extra });
/** Press a handle and drag it `dx`, `dy` port px: [session, widget] (the widget as the stage would find it). */
function pressOn(h, at = h.from ?? h.at) {
  const p = portOf(at);
  const widget = { ...s.halo().input.widgetAt(ev("press", p.x, p.y)), owner: "scene.halo" };
  return { session: s.halo().input.press(ev("press", p.x, p.y, { widget })), p, widget };
}

describe("scene.halo on the stage", () => {
  it("a handle is a widget at its distance from the eye; the thing itself is not", async () => {
    await mount({ objects: { a: object() } });
    await s.select("a");
    const x = handle("move", 0);
    const p = portOf(x.from);
    const w = s.halo().input.widgetAt(ev("move", p.x + 2, p.y));
    expect(w).toMatchObject({ part: "move", axis: 0 });
    // the point on the arrow under the pointer, 0.2 m along it
    expect(w.distance).toBeCloseTo(Math.hypot(x.from[0] + 0.2, x.from[1], x.from[2] - 10), 6);
    expect(w.onTop).toBeFalsy();
    expect(s.halo().input.widgetAt(ev("move", 100, 100))).toBe(null); // the middle of the cube
  });

  it("moves along X: holds the pose while dragging, writes the local transform on release", async () => {
    await mount({ objects: { a: object({ transform: T([0, 0, 0]) }) } });
    await s.select("a");
    const { session, p } = pressOn(handle("move", 0));
    expect(session).toBeTruthy();
    session.move(ev("move", p.x + 15, p.y + 4));
    expect(s.holds.at(-1)[0]).toBe("a");
    expect(s.holds.at(-1)[1].position).toEqual([1.5, 0, 0]);
    expect(s.doc().objects.a.transform.position).toEqual([0, 0, 0]);
    session.end(ev("move", p.x + 15, p.y + 4));
    await settle();
    expect(s.doc().objects.a.transform.position).toEqual([1.5, 0, 0]);
    expect(s.releases).toEqual([["a", { landed: true }]]);
  });

  it("a tap on a handle is still the halo's; a cancel puts it back and writes nothing", async () => {
    await mount({ objects: { a: object() } });
    await s.select("a");
    let { session, p } = pressOn(handle("move", 1));
    expect(session.tap(ev("click", p.x, p.y))).toBe(true);
    ({ session, p } = pressOn(handle("move", 1)));
    session.move(ev("move", p.x, p.y - 20));
    session.cancel();
    await settle();
    expect(s.doc().objects.a.transform.position).toEqual([0, 0, 0]);
    expect(s.releases).toEqual([["a", {}]]);
  });

  it("a press on another extension's widget, or on nothing of the halo's, isn't its", async () => {
    await mount({ objects: { a: object() } });
    await s.select("a");
    const p = portOf(handle("move", 0).from);
    expect(s.halo().input.press(ev("press", p.x, p.y, { widget: { owner: "someone.else" } }))).toBe(null);
    expect(s.halo().input.press(ev("press", 100, 100))).toBe(null);
    expect(s.halo().input.press(ev("press", p.x, p.y, { button: 2 }))).toBe(null);
  });

  it("something a peer holds: the press is still the halo's, but nothing moves", async () => {
    await mount({ objects: { a: object() } });
    await s.select("a");
    s.poses.heldBy = () => "peer";
    const { session, p } = pressOn(handle("move", 0));
    session.move(ev("move", p.x + 20, p.y));
    session.end(ev("move", p.x + 20, p.y));
    await settle();
    expect(s.holds).toEqual([]);
    expect(s.doc().objects.a.transform.position).toEqual([0, 0, 0]);
  });

  it("something here holding it ahead (a roll, a glide): refused at the first or a later move, it goes back and writes nothing", async () => {
    for (const at of [0, 1]) {
      await mount({ objects: { a: object() } });
      await s.select("a");
      const { session, p } = pressOn(handle("move", 0));
      for (let i = 0; i < 2; i++) {
        if (i === at) s.refuse.add("a");
        session.move(ev("move", p.x + 10 * (i + 1), p.y));
      }
      session.end(ev("move", p.x + 20, p.y));
      await settle();
      expect(s.doc().objects.a.transform.position).toEqual([0, 0, 0]);
      expect(s.releases).toEqual([["a", {}]]);
      s.unmount();
      s = null;
    }
  });

  it("a group: its members move together from its box, in one change", async () => {
    await mount({ objects: { g: group("G"), a: object({ group: "g", transform: T([-2, 0, 0]) }), b: object({ group: "g", transform: T([2, 0, 0]) }), l: object({ group: "g", locked: true }) } });
    await s.select("g");
    expect(s.halo().debug.target).toEqual({ kind: "group", id: "g" });
    let changes = 0;
    s.handle.on("change", () => changes++);
    const { session, p } = pressOn(handle("move", 1));
    session.move(ev("move", p.x, p.y - 10));
    session.end(ev("move", p.x, p.y - 10));
    await settle();
    expect(changes).toBe(1);
    expect(s.doc().objects.a.transform.position).toEqual([-2, 1, 0]);
    expect(s.doc().objects.b.transform.position).toEqual([2, 1, 0]);
    expect(s.doc().objects.l.transform.position).toEqual([0, 0, 0]);
  });
});

describe("scene.halo under a moving parent: drawn and dragged in the parent's frame", () => {
  // the parent heels and sails while the child is dragged: the drag is along
  // the parent's own X, and what's written is local to it, whatever it does
  const sailing = (t) => composeMatrix(T([3 + t, 0.5 * t, -t], [0.2 * t, 0.5 + t, -0.3 * t]));

  it("handles in the parent's axes; an X drag mid-voyage writes +X in the parent, wherever she has gone", async () => {
    await mount({ objects: { hull: object({ transform: T([3, 0, 0], [0, 0.5, 0]) }), winch: object({ parent: "hull", transform: T([0.5, 1, 0.25]) }) } });
    s.worlds.set("hull", sailing(0));
    s.worlds.set("winch", multiplyMatrices(sailing(0), composeMatrix(T([0.5, 1, 0.25]))));
    await s.select("winch");
    expect(s.halo().debug.frame.P()).toEqual(sailing(0));
    // in the frame the winch is where its local transform says: the box round it
    const c = s.halo().debug.center;
    expect(near(c, [0.5, 1, 0.25], 1e-9)).toBe(true);
    const x = handle("move", 0);
    expect(near([x.from[1], x.from[2]], [1, 0.25], 1e-9)).toBe(true); // along the hull's X, through the winch
    // the press: the ray through the arrow, as the screen has it now
    const { session, p } = pressOn(x);
    // she moves on, and so does the winch with her (its held world follows its parent)
    for (const t of [0.1, 0.4, 0.9]) {
      s.worlds.set("hull", sailing(t));
      s.worlds.set("winch", multiplyMatrices(sailing(t), composeMatrix(T([0.5, 1, 0.25]))));
      // the pointer where the arrow is now, plus 0.75 m along her X
      const along = s.halo().debug.frame.pointOut([x.from[0] + 0.75, x.from[1], x.from[2]]);
      const q = s.debug.viewport.project(along);
      // a ray through that screen point at that point's depth (the fake camera's rays run down -Z)
      session.move({ type: "move", x: q.x, y: q.y, button: 0, ray: { origin: [along[0], along[1], 10], dir: [0, 0, -1] } });
      const held = s.holds.at(-1);
      expect(held[0]).toBe("winch");
      expect(near(held[1].position, [1.25, 1, 0.25], 1e-6)).toBe(true);
    }
    session.end({ type: "move", x: p.x, y: p.y });
    await settle();
    const t = s.doc().objects.winch.transform;
    expect(near(t.position, [1.25, 1, 0.25], 1e-6)).toBe(true);
    expect(near(t.rotation, [0, 0, 0], 1e-9)).toBe(true);
    expect(s.doc().objects.winch.parent).toBe("hull");
  });

  it("follows her between frames: a moved parent redraws the handles where she is", async () => {
    await mount({ objects: { hull: object(), winch: object({ parent: "hull", transform: T([0.5, 1, 0.25]) }) } });
    s.worlds.set("hull", sailing(0));
    s.worlds.set("winch", multiplyMatrices(sailing(0), composeMatrix(T([0.5, 1, 0.25]))));
    const api = s.facet("scene.halo");
    const loops = new Set();
    api.loop = (fn) => (loops.add(fn), () => loops.delete(fn));
    // (the halo registered its afterRender at create: drive the viewport's hooks by hand)
    await s.select("winch");
    const frameNow = () => s.halo().debug.frame.P();
    s.worlds.set("hull", sailing(0.5));
    s.worlds.set("winch", multiplyMatrices(sailing(0.5), composeMatrix(T([0.5, 1, 0.25]))));
    for (const fn of [...s.debug.viewport.afterHooks]) fn(null, { w: 200, h: 200 });
    expect(frameNow()).toEqual(sailing(0.5));
    expect(loops.size).toBe(1); // it moved: drawn before every frame now
    for (let i = 0; i < 40; i++) for (const fn of [...loops]) fn(1 / 60);
    expect(loops.size).toBe(0); // still a while: back to looking after frames
  });
});

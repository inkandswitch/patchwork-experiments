// People aboard: the frame maths (pure), the input adapter (what's baked into
// her navmesh), and the crew against a stand-in for the stage's api (bodies,
// the camera, presence, her content as triangles). Walking itself is
// walker.test.js's; here, that the crew drives it: invariant I is asserted
// after every step (__SAILING_ASSERT__).
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { bakedObjects, behind, boardsOn, createCrew, ease, ladderTop, navInput, navKey, placeOf, seatedView, trianglesOf } from "./crew.js";
import { standOff } from "./walker.js";
import { apply, headingOf, invert, onHeading, rotateM as rotate, unrotateM as unrotate } from "./frames.js";
import { shipOf } from "./traits.js";
import { boxTriangles } from "./navmesh.js";
import { BODY, DECK, SWIM } from "./walk.js";
import { meshNode } from "./test/fakes.js";
import { MAX_SUBSTEPS, SUBSTEP } from "./physics.js";

beforeAll(() => (globalThis.__SAILING_ASSERT__ = true));
afterAll(() => delete globalThis.__SAILING_ASSERT__);

// ─── matrices ───────────────────────────────────────────────────────────────

/** A column-major 4×4 from a position, Euler XYZ rotation (as three.js composes it) and a uniform scale. */
function matrix([px, py, pz], [rx, ry, rz] = [0, 0, 0], s = 1) {
  const [a, b] = [Math.cos(rx), Math.sin(rx)];
  const [c, d] = [Math.cos(ry), Math.sin(ry)];
  const [e, f] = [Math.cos(rz), Math.sin(rz)];
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // three.js Matrix4.makeRotationFromEuler, order XYZ (row-major te below)
  const R = [
    [c * e, -c * f, d],
    [af + be * d, ae - bf * d, -b * c],
    [bf - ae * d, be + af * d, a * c],
  ];
  const m = new Array(16).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = R[row][col] * s;
  m[12] = px;
  m[13] = py;
  m[14] = pz;
  m[15] = 1;
  return m;
}

const close = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe("frames", () => {
  const m = matrix([3, -1, 7], [0.2, 1.1, -0.3], 1.5);

  it("local to world and back through the inverse", () => {
    const p = [0.4, 1.2, -2.5];
    expect(close(apply(invert(m), apply(m, p)), p)).toBe(true);
    const id = matrix([0, 0, 0]);
    expect(close(apply(id, p), p)).toBe(true);
    expect(close(apply(matrix([1, 2, 3]), [0, 0, 0]), [1, 2, 3])).toBe(true);
  });

  it("directions turn but don't scale or move, and come back", () => {
    const v = [0, 0, -1];
    const w = rotate(m, v);
    expect(Math.hypot(...w)).toBeCloseTo(1);
    expect(close(unrotate(m, w), v)).toBe(true);
  });

  it("a frame's heading is its yaw, the walker's way round", () => {
    expect(headingOf(matrix([5, 0, 5], [0, 0.7, 0]))).toBeCloseTo(0.7);
    expect(headingOf(matrix([0, 0, 0], [0.1, -2, 0]))).toBeCloseTo(-2, 1);
  });

  it("a view off the quarter turns with the heading but not with the roll", () => {
    const level = onHeading(matrix([10, 0, 0], [0, Math.PI / 2, 0]), [0, 5, 10]);
    expect(close(level, [20, 5, 0], 1e-9)).toBe(true);
    const heeled = onHeading(matrix([10, 0, 0], [0, Math.PI / 2, 0.3]), [0, 5, 10]);
    expect(heeled[1]).toBeCloseTo(5);
  });

  it("where to stand: aft of a station; inboard of a ladder on either side", () => {
    expect(behind([0, 1.6, 4.25])).toEqual([0, 1.6, 4.85]);
    expect(ladderTop([1.8, 1.2, 0.4])).toEqual([1.3, 1.2, 0.4]);
    expect(ladderTop([-1.8, 1.2, 0.4])[0]).toBeCloseTo(-1.3);
  });

  it("the ship an object is aboard: itself or the nearest ancestor with the trait", () => {
    const scene = {
      objects: { hull: { traits: { "sailing.ship": {} } }, wheel: {}, spoke: {}, buoy: {} },
      parents: new Map([["wheel", "hull"], ["spoke", "wheel"]]),
    };
    expect(shipOf(scene, "spoke")).toBe("hull");
    expect(shipOf(scene, "hull")).toBe("hull");
    expect(shipOf(scene, "buoy")).toBe(null);
  });
});

describe("avatars", () => {
  it("ease toward the latest record, the short way round, and snap when the frame changes", () => {
    const rec = { on: "ship", position: [1, 0, 0], yaw: Math.PI - 0.1, pitch: 0.2 };
    let a = ease(null, rec, 1 / 60);
    expect(a.pos).toEqual([1, 0, 0]);
    a = ease(a, { ...rec, position: [2, 0, 0], yaw: -Math.PI + 0.1 }, 1 / 60);
    expect(a.pos[0]).toBeGreaterThan(1);
    expect(a.pos[0]).toBeLessThan(1.5);
    expect(a.yaw).toBeGreaterThan(Math.PI - 0.1); // through π, not back round through 0
    for (let i = 0; i < 120; i++) a = ease(a, { ...rec, position: [2, 0, 0] }, 1 / 60);
    expect(a.pos[0]).toBeCloseTo(2, 3);
    const swum = ease(a, { on: null, position: [50, -1.3, 9], yaw: 0, pitch: 0 }, 1 / 60);
    expect(swum).toEqual({ on: null, pos: [50, -1.3, 9], yaw: 0, pitch: 0 });
  });

  it("stand in their ship's frame, or the world's; nowhere when the ship isn't here", () => {
    const m = matrix([10, 0, 0], [0, 0.5, 0]);
    const p = placeOf({ on: "ship", pos: [0, 1, 2], yaw: 0.25 }, (id) => (id === "ship" ? m : null));
    expect(close(p.position, apply(m, [0, 1, 2]))).toBe(true);
    expect(p.yaw).toBeCloseTo(0.75);
    expect(placeOf({ on: null, pos: [1, 2, 3], yaw: 1 }, () => null)).toEqual({ position: [1, 2, 3], yaw: 1 });
    expect(placeOf({ on: "gone", pos: [0, 0, 0], yaw: 0 }, () => null)).toBe(null);
  });
});

// ─── the crew on a stand-in stage ───────────────────────────────────────────

class Obj {
  constructor() {
    this.children = [];
    this.userData = {};
    this.position = { set: (...v) => (this.pos = v) };
    this.rotation = { set: (...v) => (this.rot = v) };
    this.visible = true;
    this.parent = null;
  }
  add(...o) {
    for (const c of o) (c.parent = this), this.children.push(c);
  }
  removeFromParent() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  traverse(fn) {
    fn(this);
    for (const c of this.children) c.traverse(fn);
  }
}
class Mesh extends Obj {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}
const disposable = class {
  dispose() {}
};
const THREE = {
  Group: Obj,
  Mesh,
  CapsuleGeometry: disposable,
  SphereGeometry: disposable,
  BoxGeometry: disposable,
  MeshStandardMaterial: disposable,
  MeshBasicMaterial: disposable,
  Color: class {
    setHSL(h, s, l) {
      this.hsl = [h, s, l];
      return this;
    }
  },
};

// The ship: a hull box, its deck 1.2 up, with a rail 0.62 high along each side (so you don't walk
// off her), a wheel on it (at z 3, axle 1.6 m up) and a ladder over the starboard side.
const HULL = { min: [-2, -1, -6], max: [2, 1.2, 6] };
const HULL_TRIS = [...boxTriangles(HULL.min, HULL.max), ...boxTriangles([1.9, 1.2, -6], [1.95, 1.82, 6]), ...boxTriangles([-1.95, 1.2, -6], [-1.9, 1.82, 6])];
const WHEEL_AT = [0, 1.6, 3];
const LADDER_AT = [2, 1.2, 0.4];

function stage({ shipAt = [0, 0, 0], yaw = 0, touched = true } = {}) {
  const ship = { m: matrix(shipAt, [0, yaw, 0]) };
  const local = (p) => (m) => {
    const out = matrix([0, 0, 0]);
    const w = apply(m, p);
    for (let i = 0; i < 12; i++) out[i] = m[i];
    out[12] = w[0];
    out[13] = w[1];
    out[14] = w[2];
    return out;
  };
  const worlds = { hull: () => ship.m, wheel: () => local(WHEEL_AT)(ship.m), ladder: () => local(LADDER_AT)(ship.m) };
  const scene = {
    ids: ["hull", "wheel", "ladder"],
    objects: {
      hull: { traits: { "sailing.ship": {} } },
      wheel: { traits: { "sailing.helm": { angle: 0 } }, transform: { position: WHEEL_AT } },
      ladder: { traits: { "sailing.ladder": {} }, transform: { position: LADDER_AT } },
    },
    parents: new Map([["wheel", "hull"], ["ladder", "hull"]]),
  };
  const contents = { hull: { loaded: true, box: { min: [-2, -1, -6], max: [2, 1.82, 6] }, extras: {}, root: meshNode(HULL_TRIS) } };
  const s = {
    ship,
    contents,
    bodies: [{ id: "look", sitting: null }], // the stage's body stack, its Look at the bottom
    pointer: { locked: true, released: false, refused: false },
    loops: [],
    presence: {},
    peers: {},
    rate: null,
    held: 0,
    cam: { position: [20, 8, 20], target: [0, 0, 0], fov: 50 },
    sets: [],
    labels: [],
    group: new Obj(),
    lockRefusal: false,
    rides: [], // the stage's camera rides, as asked: { id, opts }
    now: 0, // the stage's time (ms), moved by the frames
  };
  s.api = {
    id: "sailing",
    session: "me",
    viewer: "automerge:me",
    THREE,
    port: document.createElement("div"),
    style() {},
    labels: () => ({ set: (items) => (s.labels = items) }),
    world: () => s.group,
    listen: (t, type, fn, o) => t.addEventListener(type, fn, o),
    scene: () => scene,
    worldOf: (id) => worlds[id]?.() ?? null,
    content: (id) => contents[id] ?? null,
    camera: {
      touched: () => touched,
      get: () => ({ ...s.cam }),
      set: (c) => {
        s.sets.push(c);
        s.cam = { ...s.cam, ...c };
      },
      hold: () => {
        s.held++;
        return () => s.held--;
      },
      ride: (id, opts) => {
        const r = { id, opts };
        s.rides.push(r);
        return () => s.rides.splice(s.rides.indexOf(r), 1);
      },
    },
    local: { get: () => ({ body: s.body(), pointer: { ...s.pointer } }) },
    view: { get: () => ({ body: s.body(), pointer: { ...s.pointer } }) },
    // the stage's body stack, as far as the crew meets it (scene/TOOLS.md §4)
    body: {
      current: () => s.body(),
      enter(id, place = null) {
        const def = s.crew?.bodies.find((b) => b.id === id);
        const sitting = def?.enter(place);
        if (!sitting) return false;
        const prev = s.bodies.at(-1);
        s.bodies.push({ id, def, sitting, ext: "sailing" });
        prev.sitting?.input?.suspended?.();
        return true;
      },
      leave() {
        if (s.bodies.length <= 1) return false;
        const t = s.bodies.pop();
        t.sitting.leave?.();
        s.bodies.at(-1).sitting?.input?.resumed?.();
        return true;
      },
      eye: () => s.bodies.at(-1).sitting?.eye?.() ?? null,
    },
    presence: {
      set: (k, v) => (s.presence[k] = v),
      get: () => s.peers,
      rate: (hz) => (s.rate = hz),
      watch() {},
    },
    loop(fn) {
      s.loops.push(fn);
      return () => (s.loops = s.loops.filter((f) => f !== fn));
    },
    // the stage's time (scene/src/stage/time.js): now() moves with the frames; after() is the event loop's
    clock: {
      now: () => s.now,
      after(ms, fn) {
        const h = setTimeout(fn, ms);
        return () => clearTimeout(h);
      },
    },
  };
  s.ctx = {
    // a boat alone: her doc is the world (ctx.sea.world)
    sea: { ocean: { heightAt: () => 0 }, clock: () => 0, wind: null, world: () => true },
    sim: { ships: () => ["hull"], stationsOf: () => ({ helm: "wheel", sail: null, anchor: null, ladder: "ladder" }), simulating: () => false },
  };
  // play.js runs the crew's tick each frame
  s.make = () => {
    const crew = createCrew(s.api, s.ctx);
    s.crew = crew;
    s.loops.push((dt) => crew.tick(dt));
    return crew;
  };
  s.body = () => {
    const t = s.bodies.at(-1);
    return { id: t.id, ext: t.ext ?? null, label: t.sitting?.label ?? t.def?.label ?? "Look", depth: s.bodies.length - 1, lock: !!t.def?.lock, reach: t.def?.reach ?? Infinity, keys: t.sitting?.keys ?? [] };
  };
  // a key the top body declares reaches it; any other goes on (the router's key order)
  s.declared = () => (s.bodies.at(-1).sitting?.keys ?? []).map((k) => k.code);
  s.frames = (n, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      s.now += dt * 1000;
      for (const f of s.loops) f(dt);
    }
  };
  s.top = () => s.bodies.at(-1).sitting?.input;
  s.key = (code, key = code) => (s.declared().includes(code) ? s.top().key({ type: "key", code, key }) : false);
  s.keyup = (code, key = code) => s.top().keyup({ type: "keyup", code, key });
  return s;
}

describe("the crew", { timeout: 60_000 }, () => {
  it("before coming aboard, nothing is held and a click comes aboard: the aboard body, with the lock, the camera held", () => {
    const s = stage();
    const crew = s.make();
    s.ctx.crew = crew;
    expect(crew.me().playing).toBe(false);
    expect(s.bodies.length).toBe(1);
    expect(crew.input.click({})).toBe(true);
    expect(s.bodies.map((b) => b.id)).toEqual(["look", "aboard"]);
    expect(s.body()).toMatchObject({ id: "aboard", label: "Aboard", lock: true, reach: 2.5 });
    expect(s.held).toBe(1);
    expect(s.rate).toBe(null); // play.js sets the rate, not the crew
    expect(crew.input.click({})).toBe(false);
  });

  it("comes aboard by the wheel, on deck, and the camera is at the eye", () => {
    const s = stage({ shipAt: [100, 0, -50], yaw: 0.8 });
    const crew = s.make();
    crew.start();
    s.frames(10);
    const me = crew.me();
    expect(me.on).toBe("hull");
    expect(me.swimming).toBe(false);
    // just aft of the wheel, on the deck's top (1.2), in the ship's frame
    expect(me.position[0]).toBeCloseTo(0);
    expect(me.position[1]).toBeCloseTo(1.2);
    expect(me.position[2]).toBeCloseTo(3.6);
    const feetW = apply(s.ship.m, me.position);
    expect(close(me.eye, [feetW[0], feetW[1] + BODY.eye, feetW[2]], 1e-6)).toBe(true);
    expect(close(s.cam.position, me.eye, 1e-6)).toBe(true);
    expect(s.presence.crew).toMatchObject({ on: "hull", station: null });
  });

  it("the deck carries you: standing still while the ship moves keeps you where you stood", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(5);
    const before = crew.me().position;
    for (let i = 0; i < 120; i++) {
      const t = i / 60;
      s.ship.m = matrix([4 * t, 0.3 * Math.sin(2 * t), 0], [0, 0.2 * t, 0.1 * Math.sin(3 * t)]);
      s.frames(1);
    }
    const after = crew.me().position;
    expect(close(after, before, 0.01)).toBe(true);
    expect(close(s.cam.position, crew.me().eye, 1e-6)).toBe(true);
  });

  it("declares the walking keys only: F, Q and E go on to the key map", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    expect(s.declared()).toEqual(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
    expect(s.key("KeyF", "f")).toBe(false);
    expect(s.key("KeyQ", "q")).toBe(false);
    expect(s.key("KeyW", "w")).toBe(true);
    const z0 = crew.me().position[2];
    s.frames(30);
    expect(crew.me().position[2]).toBeLessThan(z0 - 1);
    s.keyup("KeyW", "w");
  });

  it("mouse-look turns you relative to the ship", () => {
    const s = stage({ yaw: 1 });
    const crew = s.make();
    crew.start();
    s.top().move({ locked: true, dx: -100, dy: 0 });
    expect(crew.me().yaw).toBeCloseTo(0.22);
    s.frames(1);
    const dir = [s.cam.target[0] - s.cam.position[0], s.cam.target[2] - s.cam.position[2]];
    expect(Math.atan2(-dir[0], -dir[1])).toBeCloseTo(1.22);
  });

  it("without the lock (refused, or the browser's Escape) it plays on: drag to look; me() says which", () => {
    const s = stage();
    s.pointer = { locked: false, released: false, refused: true };
    const crew = s.make();
    crew.start();
    expect(crew.me()).toMatchObject({ playing: true, free: true, paused: false });
    const session = s.top().press({ button: 0, locked: false, clientX: 0, clientY: 0 });
    session.move({ clientX: -50, clientY: 0 });
    expect(crew.me().yaw).toBeCloseTo(0.11);
    // a tap is a click, down the chain again
    expect(session.tap()).toBe(false);
    s.pointer = { locked: false, released: true, refused: false };
    expect(crew.me()).toMatchObject({ playing: true, free: false, paused: true });
    // under the lock a press is nothing of the body's
    expect(s.top().press({ button: 0, locked: true })).toBe(null);
  });

  it("leaving the body (Leave, the chip's) lets go: the camera, presence; and the view goes off the ship's quarter. Escape never does", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    expect(s.key("Escape")).toBe(false); // not the body's: the stage's ladder
    expect(crew.me().playing).toBe(true);
    s.api.body.leave();
    expect(s.bodies.length).toBe(1);
    expect(s.held).toBe(0);
    expect(s.presence.crew).toBe(undefined);
    expect(crew.me().playing).toBe(false);
    expect(close(s.cam.position, [12, 6.5, 16], 1e-9)).toBe(true);
    expect(s.cam.fov).toBe(50); // the orbit camera's own, not first person's
  });

  it("after leaving, a view someone else sets isn't taken back to her quarter", () => {
    const s = stage({ touched: false });
    const crew = s.make();
    s.frames(1); // first sight: the quarter, once
    crew.start();
    s.frames(2);
    crew.stop();
    s.api.camera.set({ position: [1, 2, 3], target: [0, 1, 0] });
    s.frames(3);
    expect(close(s.cam.position, [1, 2, 3], 1e-9)).toBe(true);
  });

  it("a body that isn't the crew's over walking (a seat in her cockpit): the walker waits, the camera let go; when it goes, you stand where its view was", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    // a seat: its own body, pushed over "aboard"
    s.crew.bodies.push({ id: "seat", label: "Seated", enter: () => ({ input: {}, leave() {} }) });
    s.api.body.enter("seat", "p1");
    expect(s.held).toBe(0);
    expect(crew.me().playing).toBe(false);
    expect(s.presence.crew).toBe(undefined);
    // the seat's view: a seated eye (1.15 m) over the deck
    s.api.camera.set({ position: [0.5, 1.2 + 1.15, 1], target: [0.5, 1.2, -2] });
    const sets = s.sets.length;
    s.frames(5);
    expect(s.sets.length).toBe(sets); // waiting: it doesn't move the camera
    s.api.body.leave();
    expect(s.held).toBe(1);
    expect(crew.me().playing).toBe(true);
    expect(crew.me().on).toBe("hull");
    expect(crew.me().position[0]).toBeCloseTo(0.5, 1);
    expect(crew.me().position[2]).toBeCloseTo(1, 1);
  });

  it("over the side you swim, in the world, head above the water; the ladder brings you back aboard", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    // walk to the starboard edge, then jump
    s.key("KeyD");
    s.frames(60);
    expect(crew.me().on).toBe("hull");
    s.key("Space");
    s.frames(90);
    s.keyup("Space");
    s.keyup("KeyD");
    const me = crew.me();
    expect(me.swimming).toBe(true);
    expect(me.on).toBe(null);
    expect(me.position[1]).toBeCloseTo(-SWIM.depth);
    expect(me.eye[1]).toBeCloseTo(BODY.eye - SWIM.depth);
    expect(crew.board("hull")).toBe(true);
    expect(crew.me()).toMatchObject({ on: "hull", swimming: false });
    expect(crew.me().position[0]).toBeCloseTo(1.5);
    expect(crew.me().position[1]).toBeCloseTo(1.2);
    expect(crew.me().yaw).toBeCloseTo(Math.PI / 2); // facing inboard
  });

  it("at a station: its body over walking, with the keys the station declares; you stand aft of it, and every way out calls left()", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    const seen = [];
    const handlers = {
      keys: ["KeyA", "KeyD", "KeyF"],
      key: (ev) => (seen.push(ev.code), ev.code === "KeyA"),
      keyup: () => true,
      tick: vi.fn(),
      left: vi.fn(),
      hint: () => "A / D steer · F leave",
    };
    const leave = crew.take("wheel", handlers);
    expect(s.bodies.map((b) => b.id)).toEqual(["look", "aboard", "station"]);
    expect(s.body()).toMatchObject({ id: "station", label: "Helm", reach: 2.5 });
    expect(s.held).toBe(1); // the crew's camera still: a station is ours
    expect(crew.me().station).toBe("wheel");
    expect(crew.me().hint).toBe("A / D steer · F leave");
    expect(s.declared()).toEqual(["KeyA", "KeyD", "KeyF"]);
    expect(s.key("KeyA")).toBe(true);
    expect(s.key("KeyW")).toBe(false); // not walking while you're at it
    s.frames(10);
    expect(handlers.tick).toHaveBeenCalledTimes(10);
    expect(handlers.tick).toHaveBeenLastCalledWith(1 / 60);
    // its verbs run in sea time, as far as the ships step a frame (MAX_SUBSTEPS·SUBSTEP, 0.25 s), not the
    // walker's 0.05 s: at SwiftShader's 2–3 frames a second the jib still unrolls in its 4 s of sea time
    s.frames(1, 0.2);
    expect(handlers.tick).toHaveBeenLastCalledWith(0.2);
    s.frames(1, 0.43);
    expect(handlers.tick).toHaveBeenLastCalledWith(MAX_SUBSTEPS * SUBSTEP);
    expect(crew.me().position[2]).toBeCloseTo(3.6);
    expect(s.presence.crew.station).toBe("wheel");
    // F (the station's) leaves: the station body comes off, walking where you stood
    leave();
    expect(handlers.left).toHaveBeenCalledTimes(1);
    expect(s.bodies.map((b) => b.id)).toEqual(["look", "aboard"]);
    expect(s.held).toBe(1);
    leave();
    expect(handlers.left).toHaveBeenCalledTimes(1);
    // Leave (the body chip's)
    const h2 = { left: vi.fn() };
    crew.take("wheel", h2);
    s.api.body.leave();
    expect(h2.left).toHaveBeenCalledTimes(1);
    expect(crew.me().playing).toBe(true);
    // the station gone from the doc
    const h4 = { left: vi.fn() };
    crew.take("wheel", h4);
    crew.update({ objects: {} });
    expect(h4.left).toHaveBeenCalledTimes(1);
    // the tab hidden (what you set there is written down, and the station's free)
    const hh = { left: vi.fn() };
    crew.take("wheel", hh);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.visibilityState;
    expect(hh.left).toHaveBeenCalledTimes(1);
    // the extension stopping
    const h5 = { left: vi.fn() };
    crew.take("wheel", h5);
    crew.dispose();
    expect(h5.left).toHaveBeenCalledTimes(1);
    expect(s.bodies.length).toBe(1);
  });

  it("coming aboard from a seat (aboard over it): leaving her leaves the camera to the seat, not her quarter", () => {
    const s = stage();
    const crew = s.make();
    s.crew.bodies.push({ id: "seat", label: "Seated", enter: () => ({ input: {}, leave() {} }) });
    s.api.body.enter("seat", "p1");
    crew.start();
    expect(s.bodies.map((b) => b.id)).toEqual(["look", "seat", "aboard"]);
    s.frames(2);
    const sets = s.sets.length;
    s.api.body.leave();
    expect(crew.me().playing).toBe(false);
    expect(s.sets.length).toBe(sets); // nothing set: the seat's resumed puts its view back
    expect(s.bodies.map((b) => b.id)).toEqual(["look", "seat"]);
  });

  it("a station's body needs its verb: the chip can't offer it, and entering it bare does nothing", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    expect(crew.bodies.find((b) => b.id === "station").here).toBe(false);
    expect(s.api.body.enter("station", "wheel")).toBe(false);
  });

  it("draws everyone else where they stand, in their frame, never pickable; not yourself", () => {
    const s = stage({ shipAt: [10, 0, 0] });
    const crew = s.make();
    s.peers = {
      me: { viewer: "automerge:me", keys: { sailing: { crew: { on: "hull", position: [0, 1.2, 0], yaw: 0, pitch: 0 } } } },
      p2: { viewer: "v2", keys: { sailing: { crew: { on: "hull", position: [1, 1.2, -2], yaw: 0.5, pitch: 0 } } } },
      p3: { viewer: "v3", keys: { sailing: { crew: { on: null, position: [40, -1.3, 0], yaw: 0, pitch: 0 } } } },
      p4: { viewer: "v4", keys: { other: {} } },
    };
    s.frames(1);
    expect(s.group.children.length).toBe(2);
    const [a, b] = s.group.children;
    expect(a.pos).toEqual([11, 1.2, -2]);
    expect(b.pos).toEqual([40, -1.3, 0]);
    let all = true;
    a.traverse((o) => (all &&= o.userData.noPick === true && o.raycast() === undefined));
    expect(all).toBe(true);
    // a peer leaves
    s.peers = { p2: s.peers.p2 };
    s.frames(1);
    expect(s.group.children.length).toBe(1);
  });

  it("before coming aboard, follows the ship by a base ride (sideways only), once, and lets go when it stops", () => {
    const s = stage();
    const crew = s.make();
    s.frames(3);
    expect(s.rides).toEqual([{ id: "hull", opts: { turn: false, rise: false } }]);
    // the stage moves the camera: the crew doesn't as well
    s.ship.m = matrix([3, 0.5, -1]);
    s.frames(1);
    expect(s.sets).toEqual([]);
    crew.dispose();
    expect(s.rides).toEqual([]);
  });

  it("linked into another world (a harbour), she doesn't ride the camera or place it: the harbour's view is the harbour's", () => {
    const s = stage();
    s.ctx.sea.world = () => false;
    const crew = s.make();
    s.frames(3);
    expect(s.rides).toEqual([]);
    expect(s.sets).toEqual([]);
    // her doc becoming the world (opened alone) rides her again
    s.ctx.sea.world = () => true;
    s.frames(1);
    expect(s.rides).toEqual([{ id: "hull", opts: { turn: false, rise: false } }]);
    crew.dispose();
  });

  it("a click comes aboard wherever it reaches her: the sea or the sky, the ship, anything of her doc's (what nearer takes it, a card's carry or a linked game, already has)", () => {
    const s = stage();
    s.api.scene().objects.table = { locked: true };
    s.api.scene().objects.mast = { tags: ["sailing.mast"] };
    s.api.scene().parents.set("table", "hull");
    s.api.scene().parents.set("mast", "hull");
    const scene = s.api.scene();
    expect(boardsOn(scene, null)).toBe(true);
    expect(boardsOn(scene, { id: "hull" })).toBe(true);
    expect(boardsOn(scene, { id: "wheel" })).toBe(true);
    expect(boardsOn(scene, { id: "mast" })).toBe(true);
    expect(boardsOn(scene, { id: "table" })).toBe(true);
    const crew = s.make();
    s.ctx.crew = crew;
    expect(crew.input.click({ hit: { id: "hull" } })).toBe(true);
    expect(crew.me().playing).toBe(true);
  });

  it("a click on the shore comes aboard: the islet and its lighthouse, at the root, are nobody's", () => {
    const s = stage();
    s.api.scene().objects.islet = { name: "Islet" };
    s.api.scene().objects.light = { name: "Lighthouse" };
    s.api.scene().parents.set("light", "islet");
    expect(boardsOn(s.api.scene(), { id: "islet" })).toBe(true);
    expect(boardsOn(s.api.scene(), { id: "light" })).toBe(true);
    const crew = s.make();
    s.ctx.crew = crew;
    expect(crew.input.click({ hit: { id: "islet" } })).toBe(true);
    expect(crew.me().playing).toBe(true);
  });

  it("seated at a table aboard (a body that isn't the crew's), only the sea or the sky comes aboard: not the hull round the table", () => {
    const s = stage();
    s.api.scene().objects.islet = { name: "Islet" };
    expect(boardsOn(s.api.scene(), { id: "hull" }, { seated: true })).toBe(false);
    expect(boardsOn(s.api.scene(), { id: "islet" }, { seated: true })).toBe(false);
    expect(boardsOn(s.api.scene(), null, { seated: true })).toBe(true);
    const crew = s.make();
    s.ctx.crew = crew;
    s.bodies.push({ id: "seat", def: { label: "Seated" }, sitting: { input: {} } });
    expect(seatedView(s.api)).toBe(true);
    expect(crew.input.click({ hit: { id: "hull" } })).toBe(false);
    expect(crew.me().playing).toBe(false);
    // in Look: not seated
    s.bodies.pop();
    expect(seatedView(s.api)).toBe(false);
    expect(crew.input.click({ hit: { id: "hull" } })).toBe(true);
    expect(crew.me().playing).toBe(true);
    expect(seatedView(s.api)).toBe(false); // walking her deck is the crew's own
  });

  it("a camera nobody has moved opens off the ship's quarter", () => {
    const s = stage({ shipAt: [10, 0, 5], yaw: Math.PI / 2, touched: false });
    s.make();
    s.frames(1);
    // the quarter (12, 6.5, 16 in the ship's heading frame), turned a quarter to port
    expect(close(s.cam.position, [26, 6.5, -7])).toBe(true);
    expect(close(s.cam.target, [10, 2.5, 5])).toBe(true);
    s.frames(3);
    expect(s.sets.length).toBe(1); // once; then it only follows
  });
});

describe("what's baked into her navmesh (the input adapter)", { timeout: 60_000 }, () => {
  const scene = {
    ids: ["hull", "mast", "rig", "boom2", "wheel", "windlass", "anchor", "table", "card", "dice", "hidden", "buoy"],
    objects: {
      hull: { traits: { "sailing.ship": {} } },
      mast: { tags: ["sailing.mast"] },
      rig: { traits: { "sailing.sail": {} } },
      boom2: {}, // something hung under the rig: it swings with it
      wheel: { traits: { "sailing.helm": {} } },
      windlass: { traits: { "sailing.anchor": {} } },
      anchor: { traits: { "sailing.hook": {} } },
      table: { locked: true },
      card: { tags: ["card"], traits: { "scene.carry": {} } },
      dice: { traits: { "scene.carry": {} } },
      hidden: { tags: ["sailing.mast"], visible: false },
      buoy: { traits: { "sailing.float": {} } },
    },
    parents: new Map([["mast", "hull"], ["rig", "mast"], ["boom2", "rig"], ["wheel", "hull"], ["windlass", "hull"], ["anchor", "windlass"], ["table", "hull"], ["card", "table"], ["dice", "hull"], ["hidden", "hull"]]),
  };

  it("everything under her that stays put; not the sail's subtree, the anchor, what can be carried, hidden things, or what's not aboard", () => {
    expect(bakedObjects(scene, "hull")).toEqual([
      { id: "hull", swept: false },
      { id: "mast", swept: false },
      { id: "table", swept: false },
      { id: "wheel", swept: true },
      { id: "windlass", swept: false },
    ]);
  });

  it("a content root's triangles at its rest pose, its nodes' transforms composed", () => {
    const child = meshNode([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    child.position = { x: 0, y: 2, z: 0 };
    const root = { position: { x: 10, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 2, y: 2, z: 2 }, children: [child, { ...meshNode([5, 5, 5, 6, 5, 5, 5, 5, 6]), visible: false }] };
    expect(trianglesOf(root)).toEqual([10, 4, 0, 12, 4, 0, 10, 4, 2]);
  });

  it("the bake key changes when a part of hers moves or loads, and not when a loose card does", () => {
    const s = stage();
    const k0 = navKey(s.api, "hull");
    expect(k0).toBeTruthy();
    const scene2 = s.api.scene();
    scene2.objects.card = { tags: ["card"], traits: { "scene.carry": {} }, transform: { position: [0, 1.2, 1] } };
    scene2.ids.push("card");
    scene2.parents.set("card", "hull");
    expect(navKey(s.api, "hull")).toBe(k0);
    scene2.objects.card.transform.position = [0.5, 1.2, 1];
    expect(navKey(s.api, "hull")).toBe(k0);
    scene2.objects.wheel.transform = { position: [0, 1.6, 2.5] };
    expect(navKey(s.api, "hull")).not.toBe(k0);
    s.contents.hull = { ...s.contents.hull, loaded: false };
    expect(navKey(s.api, "hull")).toBe(null); // nothing to stand on until her model's in
  });

  it("her input: her triangles in her body frame, and seeds aft of each station and at her ladder", () => {
    const s = stage();
    const input = navInput(s.api, "hull");
    expect(input.triangles.length).toBe(HULL_TRIS.length);
    expect(input.seeds.map((x) => [x.kind, x.id])).toEqual([["spawn", null], ["station", "wheel"], ["ladder", "ladder"]]);
    expect(input.seeds[0].at).toEqual(behind(WHEEL_AT));
    expect(input.seeds[2].at).toEqual(ladderTop(LADDER_AT));
  });
});

describe("the crew's walker", { timeout: 60_000 }, () => {
  it("a part moved under you rebakes off the frame loop; until it lands the old mesh is used, then you're projected onto the new one", async () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    const before = crew.nav("hull").mesh;
    // a box set down where you stand (a locked crate): her parts changed
    s.api.scene().objects.crate = { locked: true, transform: { position: [0, 1.2, 3.6] } };
    s.api.scene().ids.push("crate");
    s.api.scene().parents.set("crate", "hull");
    s.contents.crate = { loaded: true, box: null, extras: {}, root: meshNode(boxTriangles([-0.4, 0, -0.4], [0.4, 1.5, 0.4])) };
    crew.update(s.api.scene());
    s.frames(1);
    expect(crew.nav("hull").mesh).toBe(before); // not yet
    await new Promise((r) => setTimeout(r, 0));
    s.frames(1);
    expect(crew.nav("hull").mesh).not.toBe(before);
    const p = crew.me().position;
    expect(Math.max(Math.abs(p[0]), Math.abs(p[2] - 3.6))).toBeGreaterThan(0.4 + DECK.radius);
    expect(p[1]).toBeCloseTo(1.2, 5);
  });

  it("a mainsheet aboard: its stand spot (aft of it) is a seed of her bake, and taking it stands you there; leaving, you walk from there", () => {
    const s = stage();
    const sc = s.api.scene();
    sc.objects.sheet = { traits: { "sailing.mainsheet": {} }, transform: { position: [0, 1.2, 0] } };
    sc.ids.push("sheet");
    sc.parents.set("sheet", "hull");
    expect(navInput(s.api, "hull").seeds.map((x) => [x.kind, x.id])).toEqual([["spawn", null], ["station", "wheel"], ["station", "sheet"], ["ladder", "ladder"]]);
    const crew = s.make();
    crew.start();
    s.frames(2);
    const leave = crew.take("sheet", {});
    s.frames(1);
    expect(crew.me().station).toBe("sheet");
    expect(crew.walker().mode).toBe("station");
    const p = crew.me().position;
    expect(p[0]).toBeCloseTo(0, 1);
    expect(p[1]).toBeCloseTo(1.2, 5);
    expect(p[2]).toBeCloseTo(behind([0, 1.2, 0], standOff("mainsheet"))[2], 1); // 0.35 aft: its block at your feet
    expect(crew.me().yaw).toBe(0); // facing forward, over it
    // W does nothing while you're at it
    s.key("KeyW");
    s.frames(10);
    expect(crew.me().position).toEqual(p);
    leave();
    expect(crew.me().station).toBe(null);
    expect(crew.walker().mode).toBe("walking");
    expect(crew.me().position).toEqual(p);
  });

  it("25: standing up from a seat over walking: on your feet at the projection of the seat's eye, facing what its view looks at; sitting again hands the camera to the seat", () => {
    const s = stage({ shipAt: [10, 0, 0], yaw: 0.5 });
    const crew = s.make();
    crew.start();
    s.frames(2);
    s.crew.bodies.push({ id: "seat", label: "Seated", enter: () => ({ input: {}, leave() {} }) });
    s.api.body.enter("seat", "s1");
    const seatEye = apply(s.ship.m, [1, 1.2 + 1.15, -2]); // a seated eye over her deck, in the world
    const target = apply(s.ship.m, [1, 1.2, -4]); // looking forward along her
    s.api.camera.set({ position: seatEye, target });
    s.api.body.leave();
    s.frames(1);
    const me = crew.me();
    expect(me).toMatchObject({ playing: true, on: "hull", swimming: false });
    expect(me.position[0]).toBeCloseTo(1, 1);
    expect(me.position[1]).toBeCloseTo(1.2, 5);
    expect(me.position[2]).toBeCloseTo(-2, 1);
    expect(me.yaw).toBeCloseTo(0, 5); // forward, to her bow
    expect(me.pitch).toBeLessThan(0);
    // sitting again: the walker waits where it was, the camera is the seat's
    s.api.body.enter("seat", "s1");
    const sets = s.sets.length;
    s.frames(2);
    expect(crew.me().playing).toBe(false);
    expect(s.sets.length).toBe(sets);
    expect(crew.me().position).toEqual(me.position);
  });
});

// People aboard: the frame maths (pure), riding a moving deck, and the crew
// against a stand-in for the stage's api (arms, the camera, presence, rays).
import { describe, it, expect, vi } from "vitest";
import { behind, boardsOn, createCrew, deckStep, ease, ladderTop, overboard, placeOf, reframe } from "./crew.js";
import { apply, headingOf, invert, onHeading, rotateM as rotate, unrotateM as unrotate } from "./frames.js";
import { carryableAboard, shipOf } from "./traits.js";
import { BODY, DECK, SWIM } from "./walk.js";

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

  it("overboard: fallen into the water, or well under it", () => {
    expect(overboard([0, -0.1, 0], false, 0)).toBe(true);
    expect(overboard([0, 0.7, 0], true, 0.3)).toBe(false);
    expect(overboard([0, -0.1, 0], true, 0)).toBe(false); // a cockpit sole a wave's crest above
    expect(overboard([0, -1, 0], true, 0)).toBe(true);
    // in the air over the cockpit, a crest outside higher than your feet: still aboard
    expect(overboard([0, -0.1, 0], false, 0, true)).toBe(false);
    // but sunk, deck or no deck
    expect(overboard([0, -2, 0], true, 0, true)).toBe(true);
  });

  it("stepping across onto another deck: the same place in the world, in the new ship's frame", () => {
    const a = matrix([0, 0, 0], [0, 0.3, 0]);
    const b = matrix([5, 0.2, -3], [0, -1.1, 0.05]);
    const body = { feet: [1, 1.2, 2], vel: [0.5, 0, -1], yaw: 0.4 };
    const r = reframe(body, a, b);
    expect(close(apply(b, r.feet), apply(a, body.feet))).toBe(true);
    expect(close(rotate(b, r.vel), rotate(a, body.vel))).toBe(true);
    expect(r.yaw + headingOf(b)).toBeCloseTo(body.yaw + headingOf(a));
  });
});

// ─── riding a deck ──────────────────────────────────────────────────────────

/** Boxes in a frame's local space, answered as the stage's rays would be in the world. */
function deckIn(boxesLocal, mOf) {
  const hitBox = (o, d, b, max) => {
    let t0 = 0;
    let t1 = max;
    let n = null;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < b.min[i] || o[i] > b.max[i]) return null;
        continue;
      }
      let a = (b.min[i] - o[i]) / d[i];
      let c = (b.max[i] - o[i]) / d[i];
      const side = -Math.sign(d[i]);
      if (a > c) [a, c] = [c, a];
      if (a > t0) {
        t0 = a;
        n = [0, 0, 0];
        n[i] = side;
      }
      t1 = Math.min(t1, c);
      if (t0 > t1) return null;
    }
    return { distance: t0, normal: n };
  };
  const cast = (o, d, max) => {
    const m = mOf();
    const lo = apply(invert(m), o);
    const ld = unrotate(m, d);
    const h = boxesLocal.map((b) => hitBox(lo, ld, b, max)).filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
    if (!h) return null;
    const p = apply(m, lo.map((v, i) => v + ld[i] * h.distance));
    return { distance: h.distance, normal: h.normal ? rotate(m, h.normal) : null, point: p };
  };
  return {
    down: (o, max) => cast(o, [0, -1, 0], max)?.distance ?? null,
    ahead: (o, d, max) => cast(o, d, max),
    cast,
  };
}

const DECKBOX = { min: [-2, 0, -6], max: [2, 1.2, 6] };
const STILL = { forward: 0, strafe: 0 };

describe("riding a moving deck", () => {
  it("a body standing still stays where it stood while the ship sails, heaves and rolls", () => {
    let t = 0;
    // sailing at 3 m/s and speeding up, heaving, rolling ±9°, pitching, turning
    const mOf = () => matrix([3 * t + 0.4 * t * t, 0.4 * Math.sin(1.3 * t), -t], [0.06 * Math.sin(0.9 * t), 0.5 + 0.1 * t, 0.16 * Math.sin(1.7 * t)]);
    const world = deckIn([DECKBOX], mOf);
    let body = { feet: [0.5, 1.2, 1], vel: [0, 0, 0], onGround: true, yaw: 0 };
    for (let i = 0; i < 600; i++) {
      t += 1 / 60;
      body = { ...body, ...deckStep(body, STILL, mOf(), 1 / 60, world) };
    }
    expect(body.onGround).toBe(true);
    expect(body.feet[0]).toBeCloseTo(0.5, 2);
    expect(body.feet[1]).toBeCloseTo(1.2, 2);
    expect(body.feet[2]).toBeCloseTo(1, 2);
  });

  it("forward is toward the bow whichever way the ship heads, and the walk is the deck's", () => {
    let t = 0;
    const mOf = () => matrix([5 * t, 0, 0], [0, 2.2, 0]);
    const world = deckIn([DECKBOX], mOf);
    let body = { feet: [0, 1.2, 4], vel: [0, 0, 0], onGround: true, yaw: 0 };
    for (let i = 0; i < 60; i++) {
      t += 1 / 60;
      body = { ...body, ...deckStep(body, { forward: 1, strafe: 0 }, mOf(), 1 / 60, world) };
    }
    expect(Math.abs(body.feet[0])).toBeLessThan(1e-6);
    expect(body.feet[2]).toBeLessThan(4 - 0.8 * DECK.walk);
    expect(body.feet[2]).toBeGreaterThan(4 - DECK.walk);
  });

  it("keeps to the deck at its edge, rolling", () => {
    let t = 0;
    const mOf = () => matrix([0, 0, 0], [0, 0, 0.12 * Math.sin(2 * t)]);
    const world = deckIn([DECKBOX], mOf);
    let body = { feet: [0, 1.2, 0], vel: [0, 0, 0], onGround: true, yaw: 0 };
    for (let i = 0; i < 300; i++) {
      t += 1 / 60;
      body = { ...body, ...deckStep(body, { forward: 0, strafe: 1 }, mOf(), 1 / 60, world) };
    }
    expect(body.onGround).toBe(true);
    expect(body.feet[0]).toBeLessThan(2);
    expect(body.feet[0]).toBeGreaterThan(1.3);
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

// The ship: a hull box with a wheel on it (at z 3, axle 1.6 m up) and a ladder over the starboard side.
const HULL = { min: [-2, -1, -6], max: [2, 1.2, 6] };
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
  const deck = deckIn([HULL], () => ship.m);
  const scene = {
    objects: { hull: { traits: { "sailing.ship": {} } }, wheel: { traits: { "sailing.helm": { angle: 0 } } }, ladder: {} },
    parents: new Map([["wheel", "hull"], ["ladder", "hull"]]),
  };
  const s = {
    ship,
    arms: [],
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
    content: () => null,
    raycast: (o, d, { far = Infinity, skip } = {}) => {
      if (skip?.("hull")) return null;
      const h = deck.cast(o, d, far);
      return h ? { id: "hull", ...h } : null;
    },
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
    },
    arm(handlers, opts = {}) {
      const e = { handlers, opts };
      s.arms.push(e);
      if (opts.lock && s.lockRefusal) queueMicrotask(() => handlers.lockLost?.({ refused: true }));
      return () => {
        const i = s.arms.indexOf(e);
        if (i < 0) return;
        s.arms.splice(i, 1);
        handlers.disarmed?.();
      };
    },
    relock: () => Promise.resolve(),
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
  };
  s.ctx = {
    sea: { ocean: { heightAt: () => 0 }, clock: () => 0, wind: null },
    sim: { ships: () => ["hull"], stationsOf: () => ({ helm: "wheel", sail: null, anchor: null, ladder: "ladder" }), simulating: () => false },
  };
  // play.js runs the crew's tick each frame
  s.make = () => {
    const crew = createCrew(s.api, s.ctx);
    s.loops.push((dt) => crew.tick(dt));
    return crew;
  };
  s.frames = (n, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) for (const f of s.loops) f(dt);
  };
  s.top = () => s.arms.at(-1)?.handlers;
  s.key = (code, key = code) => s.top().key({ type: "key", code, key });
  s.keyup = (code, key = code) => s.top().keyup({ type: "keyup", code, key });
  return s;
}

describe("the crew", () => {
  it("before coming aboard, nothing is held and a click comes aboard: an arm with the lock, the camera held", () => {
    const s = stage();
    const crew = s.make();
    s.ctx.crew = crew;
    expect(crew.me().playing).toBe(false);
    expect(s.arms.length).toBe(0);
    expect(crew.input.click({})).toBe(true);
    expect(s.arms.length).toBe(1);
    expect(s.arms[0].opts).toMatchObject({ lock: true, immersive: true });
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

  it("walks on W only, and lets F, Q and E go on to the use prompt", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
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

  it("a refused lock plays on without it: drag to look", async () => {
    const s = stage();
    s.lockRefusal = true;
    const crew = s.make();
    crew.start();
    await Promise.resolve();
    expect(crew.me()).toMatchObject({ playing: true, free: true, paused: false });
    const session = s.top().press({ button: 0, locked: false, clientX: 0, clientY: 0 });
    session.move({ clientX: -50, clientY: 0 });
    expect(crew.me().yaw).toBeCloseTo(0.11);
  });

  it("Esc lets go: the arm, the camera, presence; and the view goes off the ship's quarter", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    s.key("Escape");
    expect(s.arms.length).toBe(0);
    expect(s.held).toBe(0);
    expect(s.presence.crew).toBe(undefined);
    expect(crew.me().playing).toBe(false);
    expect(close(s.cam.position, [12, 6.5, 16], 1e-9)).toBe(true);
    expect(s.cam.fov).toBe(50); // the orbit's own, not first person's
  });

  it("after Esc, a view someone else sets (a seat at a table aboard) isn't taken back to her quarter", () => {
    const s = stage({ touched: false });
    const crew = s.make();
    s.frames(1); // first sight: the quarter, once
    crew.start();
    s.frames(2);
    s.key("Escape");
    s.api.camera.set({ position: [1, 2, 3], target: [0, 1, 0] });
    s.frames(3);
    expect(close(s.cam.position, [1, 2, 3], 1e-9)).toBe(true);
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

  it("at a station: an arm over walking hears keys first, you stand aft of it, and every way out calls left()", () => {
    const s = stage();
    const crew = s.make();
    crew.start();
    s.frames(2);
    const seen = [];
    const handlers = {
      key: (ev) => (seen.push(ev.code), ev.code === "KeyA"),
      keyup: () => true,
      tick: vi.fn(),
      left: vi.fn(),
      hint: () => "A / D steer · F leave",
    };
    const leave = crew.take("wheel", handlers);
    expect(s.arms.length).toBe(2);
    expect(crew.me().station).toBe("wheel");
    expect(crew.me().hint).toBe("A / D steer · F leave");
    expect(s.key("KeyA")).toBe(true);
    expect(s.key("KeyW")).toBe(false); // not walking while you're at it
    s.frames(10);
    expect(handlers.tick).toHaveBeenCalledTimes(10);
    expect(crew.me().position[2]).toBeCloseTo(3.6);
    expect(s.presence.crew.station).toBe("wheel");
    // F (the station's) leaves
    leave();
    expect(handlers.left).toHaveBeenCalledTimes(1);
    expect(s.arms.length).toBe(1);
    leave();
    expect(handlers.left).toHaveBeenCalledTimes(1);
    // Esc
    const h2 = { left: vi.fn() };
    crew.take("wheel", h2);
    s.key("Escape");
    expect(h2.left).toHaveBeenCalledTimes(1);
    expect(crew.me().playing).toBe(true);
    // the lock lost
    const h3 = { left: vi.fn() };
    crew.take("wheel", h3);
    s.arms[0].handlers.lockLost({ refused: false });
    expect(h3.left).toHaveBeenCalledTimes(1);
    expect(crew.me().paused).toBe(true);
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
    expect(s.arms.length).toBe(0);
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

  it("follows the ship sideways before coming aboard", () => {
    const s = stage();
    s.make();
    s.frames(1);
    s.ship.m = matrix([3, 0.5, -1]);
    s.frames(1);
    expect(close(s.cam.position, [23, 8, 19])).toBe(true);
    expect(close(s.cam.target, [3, 0, -1])).toBe(true);
  });

  it("stands still while the orbit is dragged, and follows again after (the stage stops the release at the port)", () => {
    const s = stage();
    s.make();
    s.api.port.addEventListener("pointerup", (e) => e.stopPropagation(), { capture: true });
    document.body.append(s.api.port);
    s.frames(1);
    s.api.port.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    s.ship.m = matrix([3, 0, 0]);
    s.frames(1);
    expect(close(s.cam.target, [0, 0, 0])).toBe(true); // held still while dragging
    s.api.port.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    s.ship.m = matrix([5, 0, 0]);
    s.frames(1);
    expect(close(s.cam.target, [5, 0, 0])).toBe(true);
    s.api.port.remove();
  });

  it("on a stage with rides, follows by a fallback ride (sideways only), once, and lets go when it stops", () => {
    const s = stage();
    const rides = [];
    s.api.camera.ride = (id, opts) => {
      const r = { id, opts };
      rides.push(r);
      return () => rides.splice(rides.indexOf(r), 1);
    };
    const crew = s.make();
    s.frames(3);
    expect(rides).toEqual([{ id: "hull", opts: { turn: false, rise: false, fallback: true } }]);
    // the stage moves the camera now: the crew doesn't as well
    s.ship.m = matrix([3, 0.5, -1]);
    s.frames(1);
    expect(s.sets).toEqual([]);
    crew.dispose();
    expect(rides).toEqual([]);
  });

  it("a click comes aboard from the sea or the sky, the ship or a fitting of hers; not from something else aboard her", () => {
    const s = stage();
    s.api.scene().objects.card = { traits: { "tabletop.hidden": {} }, tags: ["card"] };
    s.api.scene().objects.mast = { tags: ["sailing.mast"] };
    s.api.scene().parents.set("card", "hull");
    s.api.scene().parents.set("mast", "hull");
    const scene = s.api.scene();
    expect(boardsOn(scene, null)).toBe(true);
    expect(boardsOn(scene, { id: "hull" })).toBe(true);
    expect(boardsOn(scene, { id: "wheel" })).toBe(true);
    expect(boardsOn(scene, { id: "mast" })).toBe(true);
    expect(boardsOn(scene, { id: "card" })).toBe(false);
    const crew = s.make();
    s.ctx.crew = crew;
    expect(crew.input.click({ hit: { id: "card" } })).toBe(false);
    expect(crew.me().playing).toBe(false);
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

  it("seated at a table aboard (the view riding it), only the sea or the sky comes aboard: not the hull round the table", () => {
    const s = stage();
    s.api.scene().objects.islet = { name: "Islet" };
    expect(boardsOn(s.api.scene(), { id: "hull" }, { seated: true })).toBe(false);
    expect(boardsOn(s.api.scene(), { id: "islet" }, { seated: true })).toBe(false);
    expect(boardsOn(s.api.scene(), null, { seated: true })).toBe(true);
    let ride = { id: "table", fallback: false };
    s.api.camera.riding = () => ride;
    const crew = s.make();
    s.ctx.crew = crew;
    expect(crew.input.click({ hit: { id: "hull" } })).toBe(false);
    expect(crew.me().playing).toBe(false);
    // only the ship's own follow (a fallback): not seated
    ride = { id: "hull", fallback: true };
    expect(crew.input.click({ hit: { id: "hull" } })).toBe(true);
    expect(crew.me().playing).toBe(true);
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

describe("the hand aboard (scene.hand's carryable)", () => {
  it("never the ship nor a fitting of hers; anything else aboard is no business of sailing's", () => {
    const scene = {
      objects: {
        hull: { traits: { "sailing.ship": {} } },
        mast: { tags: ["sailing.mast"] },
        rig: { traits: { "sailing.sail": {} } },
        anchor: { traits: { "sailing.hook": {} } },
        table: { locked: true },
        card: { traits: { "tabletop.hidden": {} }, tags: ["card"] },
        buoy: { traits: { "sailing.float": {} } },
      },
      parents: new Map([["mast", "hull"], ["rig", "mast"], ["anchor", "hull"], ["table", "hull"], ["card", "table"]]),
    };
    for (const id of ["hull", "mast", "rig", "anchor", "buoy"]) expect(carryableAboard(scene, id)).toBe(false);
    for (const id of ["table", "card", "nothing"]) expect(carryableAboard(scene, id)).toBeUndefined();
  });
});

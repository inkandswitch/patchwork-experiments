// The walker (the arena's, with a ledge and swimming): against a world of
// boxes answered the way the scene's raycasts would be.
import { describe, it, expect } from "vitest";
import { BODY, DECK, SWIM, look, lookDir, step, swim, wishVelocity } from "./walk.js";

/** A world of axis-aligned boxes; rays in any direction. */
function boxes(list) {
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
  const cast = (o, d, max) =>
    list
      .map((b) => hitBox(o, d, b, max))
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)[0] ?? null;
  return {
    down: (o, max) => cast(o, [0, -1, 0], max)?.distance ?? null,
    ahead: (o, d, max) => cast(o, d, max),
  };
}

const floor = { min: [-50, -1, -50], max: [50, 0, 50] };
const run = (state, input, yaw, world, frames = 60, body = BODY) => {
  for (let i = 0; i < frames; i++) state = step(state, input, yaw, 1 / 60, world, body);
  return state;
};
const standing = (feet = [0, 0, 0]) => ({ feet, vel: [0, 0, 0], onGround: true });
const FORWARD = { forward: 1, strafe: 0 };

describe("walking (the arena's walker)", () => {
  it("forward is -z at yaw 0, and diagonal is no faster", () => {
    const [x, z] = wishVelocity(FORWARD, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-BODY.walk);
    const [dx, dz] = wishVelocity({ forward: 1, strafe: 1 }, 0);
    expect(Math.hypot(dx, dz)).toBeCloseTo(BODY.walk);
  });

  it("stands on the floor and walks along it", () => {
    const s = run(standing(), FORWARD, 0, boxes([floor]));
    expect(s.onGround).toBe(true);
    expect(s.feet[1]).toBeCloseTo(0);
    expect(s.feet[2]).toBeLessThan(-3);
  });

  it("stops at a wall, short by its radius, and slides along it", () => {
    const wall = { min: [-50, 0, -3], max: [50, 3, -2.5] };
    const world = boxes([floor, wall]);
    const s = run(standing(), FORWARD, 0, world, 120);
    expect(s.feet[2]).toBeGreaterThan(-2.5 + BODY.radius - 0.01);
    expect(s.feet[2]).toBeLessThan(-2.5 + BODY.radius + 0.05);
    const slid = run(s, { forward: 1, strafe: 1 }, 0, world, 60);
    expect(slid.feet[0]).toBeGreaterThan(2);
    expect(slid.feet[2]).toBeGreaterThan(-2.5 + BODY.radius - 0.01);
  });

  it("walks up a low step but not a tall one", () => {
    const low = { min: [-1, 0, -4], max: [1, 0.3, -2] };
    expect(run(standing(), FORWARD, 0, boxes([floor, low]), 50).feet[1]).toBeCloseTo(0.3);
    const tall = { min: [-1, 0, -4], max: [1, 1.2, -2] };
    const t = run(standing(), FORWARD, 0, boxes([floor, tall]), 50);
    expect(t.feet[1]).toBeCloseTo(0);
    expect(t.feet[2]).toBeGreaterThan(-2 + BODY.radius - 0.01);
  });

  it("jumps, falls and lands", () => {
    const world = boxes([floor]);
    let s = step(standing(), { forward: 0, strafe: 0, jump: true }, 0, 1 / 60, world);
    expect(s.onGround).toBe(false);
    let peak = 0;
    let landed = false;
    for (let i = 0; i < 120; i++) {
      s = step(s, { forward: 0, strafe: 0 }, 0, 1 / 60, world);
      peak = Math.max(peak, s.feet[1]);
      landed ||= s.landed;
    }
    expect(peak).toBeGreaterThan(0.6);
    expect(landed).toBe(true);
    expect(s.feet[1]).toBeCloseTo(0);
  });

  it("looks about without turning over", () => {
    expect(look(0, 0, 0, -1e6).pitch).toBeLessThan(Math.PI / 2);
    expect(lookDir(0, 0)[2]).toBeCloseTo(-1);
  });
});

describe("on a deck", () => {
  // a deck 4 m wide and 10 long, its top at y = 1, over nothing
  const deck = { min: [-2, 0, -5], max: [2, 1, 5] };
  const cabin = { min: [-0.9, 1, -2], max: [0.9, 1.45, 1] };

  it("steps up onto a cabin top half a metre high", () => {
    const s = run(standing([0, 1, 3]), FORWARD, 0, boxes([deck, cabin]), 60, DECK);
    expect(s.feet[1]).toBeCloseTo(1.45);
  });

  it("won't walk off the edge: it stops with its toes there", () => {
    const s = run(standing([0, 1, 0]), { forward: 0, strafe: 1 }, 0, boxes([deck]), 120, DECK);
    expect(s.onGround).toBe(true);
    expect(s.feet[1]).toBeCloseTo(1);
    expect(s.feet[0]).toBeLessThanOrEqual(2 - DECK.radius + 1e-6);
    expect(s.feet[0]).toBeGreaterThan(2 - DECK.radius - 0.15);
  });

  it("slides along the edge when the move is partly along it", () => {
    const s = run(standing([1.5, 1, 0]), { forward: 1, strafe: 1 }, 0, boxes([deck]), 60, DECK);
    expect(s.feet[2]).toBeLessThan(-1.5);
    expect(s.feet[0]).toBeLessThanOrEqual(2 - DECK.radius + 1e-6);
  });

  it("steps down a drop it can (the cockpit), but the arena's body walks off anything", () => {
    const sole = { min: [-0.8, 0, 2], max: [0.8, 0.5, 4] };
    const aft = { min: [-2, 0, -5], max: [2, 1, 2] };
    const s = run(standing([0, 1, 1]), { forward: -1, strafe: 0 }, 0, boxes([aft, sole]), 60, DECK);
    expect(s.feet[1]).toBeCloseTo(0.5);
    const off = run(standing([0, 1, 0]), { forward: 0, strafe: 1 }, 0, boxes([deck]), 60);
    expect(off.onGround).toBe(false);
  });

  it("a jump takes you over the side", () => {
    let s = run(standing([1.5, 1, 0]), { forward: 0, strafe: 1 }, 0, boxes([deck]), 30, DECK);
    s = step(s, { forward: 0, strafe: 1, jump: true }, 0, 1 / 60, boxes([deck]), DECK);
    s = run(s, { forward: 0, strafe: 1 }, 0, boxes([deck]), 60, DECK);
    expect(s.feet[0]).toBeGreaterThan(2);
    expect(s.feet[1]).toBeLessThan(0);
  });
});

describe("swimming", () => {
  const flat = { surface: () => 0, ahead: () => null };

  it("floats with the head above the water, and bobs with it", () => {
    let s = swim({ feet: [0, -5, 0], vel: [0, 0, 0] }, { forward: 0, strafe: 0 }, 0, 1 / 60, flat);
    expect(s.feet[1]).toBeCloseTo(-SWIM.depth);
    expect(s.feet[1] + BODY.eye).toBeCloseTo(0.3);
    const wave = { surface: (x) => 0.5 + x * 0.1, ahead: () => null };
    s = swim({ feet: [2, 0, 0], vel: [0, 0, 0] }, { forward: 0, strafe: 0 }, 0, 1 / 60, wave);
    expect(s.feet[1]).toBeCloseTo(0.7 - SWIM.depth);
  });

  it("swims slowly, and can't jump", () => {
    let s = { feet: [0, -SWIM.depth, 0], vel: [0, 0, 0] };
    for (let i = 0; i < 180; i++) s = swim(s, { forward: 1, strafe: 0, run: false, jump: true }, 0, 1 / 60, flat);
    expect(-s.vel[2]).toBeCloseTo(SWIM.walk, 1);
    expect(s.feet[1]).toBeCloseTo(-SWIM.depth);
    expect(s.feet[2]).toBeLessThan(-2);
    expect(s.feet[2]).toBeGreaterThan(-4.5);
  });

  it("the hull is in the way, at the waterline", () => {
    const hull = boxes([{ min: [-2, -2, -5], max: [2, 1.2, 5] }]);
    let s = { feet: [4, -SWIM.depth, 0], vel: [0, 0, 0] };
    for (let i = 0; i < 300; i++) s = swim(s, { forward: 0, strafe: -1 }, 0, 1 / 60, { surface: () => 0, ahead: hull.ahead });
    expect(s.feet[0]).toBeGreaterThan(2 + SWIM.radius - 0.02);
    expect(s.feet[0]).toBeLessThan(2.6);
  });
});

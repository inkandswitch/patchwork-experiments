import { describe, it, expect } from "vitest";
import { BODY, look, lookDir, step, wishVelocity } from "./walk.js";
import { KINDS, knockedOver, sampleArena, yawThenTilt } from "./level.js";

/** A world of axis-aligned boxes, answered the way the scene's raycasts would be. */
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
      let side = -Math.sign(d[i]);
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
  const cast = (o, d, max) => list.map((b) => hitBox(o, d, b, max)).filter(Boolean).sort((a, b) => a.distance - b.distance)[0] ?? null;
  return {
    down: (o, max) => cast(o, [0, -1, 0], max)?.distance ?? null,
    ahead: (o, d, max) => cast(o, d, max),
  };
}

const floor = { min: [-50, -1, -50], max: [50, 0, 50] };
const run = (state, input, yaw, world, frames = 60) => {
  for (let i = 0; i < frames; i++) state = step(state, input, yaw, 1 / 60, world);
  return state;
};

describe("walking", () => {
  it("forward is -z at yaw 0, and diagonal is no faster", () => {
    const [x, z] = wishVelocity({ forward: 1, strafe: 0 }, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-BODY.walk);
    const [dx, dz] = wishVelocity({ forward: 1, strafe: 1 }, 0);
    expect(Math.hypot(dx, dz)).toBeCloseTo(BODY.walk);
  });

  it("stands on the floor and walks along it", () => {
    const world = boxes([floor]);
    const s = run({ feet: [0, 0, 0], vel: [0, 0, 0], onGround: true }, { forward: 1, strafe: 0 }, 0, world);
    expect(s.onGround).toBe(true);
    expect(s.feet[1]).toBeCloseTo(0);
    expect(s.feet[2]).toBeLessThan(-3);
  });

  it("stops at a wall, short by its radius, and slides along it", () => {
    const wall = { min: [-50, 0, -3], max: [50, 3, -2.5] };
    const world = boxes([floor, wall]);
    const s = run({ feet: [0, 0, 0], vel: [0, 0, 0], onGround: true }, { forward: 1, strafe: 0 }, 0, world, 120);
    expect(s.feet[2]).toBeGreaterThan(-2.5 + BODY.radius - 0.01);
    expect(s.feet[2]).toBeLessThan(-2.5 + BODY.radius + 0.05);
    const slid = run(s, { forward: 1, strafe: 1 }, 0, world, 60);
    expect(slid.feet[0]).toBeGreaterThan(2);
    expect(slid.feet[2]).toBeGreaterThan(-2.5 + BODY.radius - 0.01);
  });

  it("walks up a low step but not a tall one", () => {
    const low = { min: [-1, 0, -4], max: [1, 0.3, -2] };
    const s = run({ feet: [0, 0, 0], vel: [0, 0, 0], onGround: true }, { forward: 1, strafe: 0 }, 0, boxes([floor, low]), 50);
    expect(s.feet[1]).toBeCloseTo(0.3);
    const tall = { min: [-1, 0, -4], max: [1, 1.2, -2] };
    const t = run({ feet: [0, 0, 0], vel: [0, 0, 0], onGround: true }, { forward: 1, strafe: 0 }, 0, boxes([floor, tall]), 50);
    expect(t.feet[1]).toBeCloseTo(0);
    expect(t.feet[2]).toBeGreaterThan(-2 + BODY.radius - 0.01);
  });

  it("jumps, falls and lands", () => {
    const world = boxes([floor]);
    let s = step({ feet: [0, 0, 0], vel: [0, 0, 0], onGround: true }, { forward: 0, strafe: 0, jump: true }, 0, 1 / 60, world);
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
    const l = look(0, 0, 0, -1e6);
    expect(l.pitch).toBeLessThan(Math.PI / 2);
    const d = lookDir(0, 0);
    expect(d[2]).toBeCloseTo(-1);
  });
});

describe("the level", () => {
  it("every kind draws something; the sample has targets and spawns", () => {
    for (const k of Object.values(KINDS)) expect(k.meshes().length).toBeGreaterThan(0);
    const a = sampleArena();
    expect(a.filter((o) => o.traits?.["arena.target"]).length).toBeGreaterThanOrEqual(6);
    expect(a.filter((o) => o.traits?.["arena.spawn"]).length).toBe(4);
    expect(a.every((o) => KINDS[o.kind])).toBe(true);
  });

  it("a knocked-over target lies down, still facing the way it stood", () => {
    const t = { position: [1, 0, 2], rotation: [0, 0.5, 0], scale: 1 };
    const down = knockedOver(t, 0.5 + Math.PI);
    // its up axis is now nearly horizontal
    const [x, y, z] = down.rotation;
    // the target's local +Y in world (column 1 of R = Rx Ry Rz)
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    const up = [-cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz];
    expect(Math.abs(up[1])).toBeLessThan(0.05);
    expect(down.position).toEqual([1, 0, 2]);
  });

  it("yaw then tilt matches the composed rotation", () => {
    const [x, y, z] = yawThenTilt(0.7, 0.3);
    const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    // R = Rx Ry Rz, element (1,1) and (2,2): compare with Ry(0.7)·Rx(0.3)
    expect(cx * cz - sx * sy * sz).toBeCloseTo(Math.cos(0.3));
    expect(cy * cz).toBeCloseTo(Math.cos(0.7));
  });
});

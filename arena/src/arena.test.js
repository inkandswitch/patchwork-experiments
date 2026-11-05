import { describe, it, expect } from "vitest";
import { BODY, look, lookDir, step, wishVelocity } from "./walk.js";
import { KINDS, PALETTE, knockedOver, sampleArena, yawThenTilt } from "./level.js";
import { ART, kindGLB, kindKey } from "./build.js";
import { parseGLB } from "./glb.js";

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

  it("every kind is coloured per vertex (a white material under COLOR_0), and encodes", () => {
    for (const [kind, k] of Object.entries(KINDS)) {
      for (const m of k.meshes()) {
        expect(m.colors.length).toBe(m.positions.length);
        expect(m.color).toBe("#ffffff");
      }
      const { json } = parseGLB(kindGLB(kind));
      expect(json.meshes.every((m) => m.primitives.every((p) => p.attributes.COLOR_0 !== undefined))).toBe(true);
    }
    // the spawn pad's glow is unlit, so it reads as lit from within
    const { json } = parseGLB(kindGLB("spawn"));
    expect(json.extensionsUsed).toContain("KHR_materials_unlit");
  });

  it("the floor is a checker of two tones; a target's rings alternate out from a gold bull", () => {
    const [floor] = KINDS.floor.meshes();
    // the top's tiles: the first vertex of each upward quad, its colour's red channel
    const tops = [];
    for (let q = 0; q < floor.positions.length / 12; q++) if (floor.normals[q * 12 + 1] === 1) tops.push(floor.colors[q * 12]);
    expect(tops.length).toBe(400);
    const light = tops.filter((r, i) => r > tops[(i + 1) % tops.length]).length;
    expect(light).toBeGreaterThan(150);
    // the board's front, sampled along +x at the board's height (1.55 m)
    const [target] = KINDS.target.meshes();
    const at = (r) => {
      for (let q = 0; q < target.positions.length / 12; q++) {
        if (target.normals[q * 12 + 2] !== 1) continue;
        const xs = [0, 1, 2, 3].map((k) => Math.hypot(target.positions[q * 12 + k * 3], target.positions[q * 12 + k * 3 + 1] - 1.55));
        if (r > Math.min(...xs) && r < Math.max(...xs) && Math.abs(target.positions[q * 12 + 1] - 1.55) < 0.01) return target.colors.slice(q * 12, q * 12 + 3);
      }
      return null;
    };
    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const isLike = (lin, hex) => lin && Math.abs(Math.pow(lin[0], 1 / 2.2) * 255 - rgb(hex)[0]) < 12;
    expect(isLike(at(0.04), PALETTE.bull)).toBe(true);
    expect(isLike(at(0.13), PALETTE.ringRed)).toBe(true);
    expect(isLike(at(0.22), PALETTE.ringLight)).toBe(true);
    expect(isLike(at(0.31), PALETTE.ringRed)).toBe(true);
    expect(isLike(at(0.4), PALETTE.ringLight)).toBe(true);
  });

  it("kind GLBs are remembered per art version, so new art isn't hidden behind old", () => {
    expect(kindKey("crate")).toBe(`crate@${ART}`);
    expect(ART).toBeGreaterThan(1);
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

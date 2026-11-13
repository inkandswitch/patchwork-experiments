import { describe, it, expect } from "vitest";
import { KINDS, PALETTE, knockedOver, sampleArena, yawThenTilt } from "./level.js";
import { ART, kindGLB, kindKey } from "./layout.js";
import { parseGLB } from "./glb.js";

describe("the level", () => {
  it("every kind draws something; the sample has targets and spawns", () => {
    for (const k of Object.values(KINDS)) expect(k.meshes().length).toBeGreaterThan(0);
    const a = sampleArena();
    expect(a.filter((o) => o.traits?.["arena.target"]).length).toBeGreaterThanOrEqual(6);
    expect(a.filter((o) => o.traits?.["walk.spawn"]).length).toBe(4);
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
    expect(kindKey("crate")).toBe(`arena/crate@${ART}`);
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

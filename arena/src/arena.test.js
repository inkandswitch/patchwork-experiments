import { describe, it, expect } from "vitest";
import { KINDS, knockedOver, sampleArena, yawThenTilt } from "./level.js";
import { kindGLB } from "./layout.js";
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

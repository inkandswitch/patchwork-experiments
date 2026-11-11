import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseGLB } from "./glb.js";
import { poseBeside, spot, baseLift, halfWidth } from "./place.js";
import { sackGLB, sackProfile } from "./sack.js";
import source from "./source.js";

describe("the sack", () => {
  it("is a valid GLB at real size: as wide as it says, standing on y = 0, origin at the middle of its base", () => {
    for (const size of [0.02, 0.2, 0.35, 2]) {
      const { glb, bounds } = sackGLB({ color: "#7a5a3a", size });
      const { json } = parseGLB(glb);
      expect(json.asset.version).toBe("2.0");
      expect(json.meshes.map((m) => m.name)).toEqual(["sack", "cord"]);
      expect(bounds.min[1]).toBeCloseTo(0, 6);
      expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(size, 3);
      expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(size, 3);
      expect((bounds.max[0] + bounds.min[0]) / 2).toBeCloseTo(0, 6);
      expect(bounds.max[1]).toBeGreaterThan(size);
    }
  });

  it("its outline starts on the axis at the base and never goes below it", () => {
    const p = sackProfile(0.2);
    expect(p[0]).toEqual([0, 0]);
    expect(p.every(([r, y]) => r >= 0 && y >= 0)).toBe(true);
  });

  it("the source builds it from the bag's look alone: contents don't rebuild it", async () => {
    const doc = { look: { color: "#112233", size: 0.3 }, items: {} };
    const built = await source.build({ doc });
    expect(built.kind).toBe("glb");
    expect(built.meta.bounds.max[0] - built.meta.bounds.min[0]).toBeCloseTo(0.3, 3);
    const fp = source.fingerprint(doc);
    expect(source.fingerprint({ ...doc, title: "Renamed", rule: "top", items: { a: { id: "a" } } })).toBe(fp);
    expect(source.fingerprint({ ...doc, look: { color: "#112233", size: 0.31 } })).not.toBe(fp);
    expect(source.fingerprint({ ...doc, look: { color: "#112234", size: 0.3 } })).not.toBe(fp);
  });

  it("glb.js is the kit's (v3): copied whole, never edited here", () => {
    expect(readFileSync(join(process.cwd(), "src", "glb.js"), "utf8").slice(0, 600)).toMatch(/\[kit: glb\.js v3\]/);
  });
});

describe("setting things down beside a bag", () => {
  it("the first 48 spots are all different, all clear of the bag, and further out ring by ring", () => {
    const reach = 0.1;
    const step = 0.03;
    const seen = new Set();
    let last = 0;
    for (let k = 0; k < 48; k++) {
      const [x, z] = spot(k, reach, step);
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThan(reach);
      expect(r).toBeGreaterThanOrEqual(last - 1e-4); // (spots are rounded to 10 µm)
      last = r;
      seen.add(`${x},${z}`);
    }
    expect(seen.size).toBe(48);
    // neighbours on the first ring are at least a step apart
    const [a, b] = [spot(0, reach, step), spot(1, reach, step)];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(step);
  });

  it("a thing is set down on its base, beside the bag, in the bag's frame", () => {
    const entry = { object: { hint: { bounds: { min: [-0.01, -0.005, -0.02], max: [0.01, 0.005, 0.02] } } }, scale: 2 };
    expect(baseLift(entry.object, 2)).toBeCloseTo(0.01);
    expect(halfWidth(entry.object, 2)).toBeCloseTo(0.04);
    const pose = poseBeside({ position: [1, 0.7, -2] }, 0.1, 0, entry);
    expect(pose.rotation).toEqual([0, 0, 0]);
    expect(pose.position[1]).toBeCloseTo(0.71);
    expect(Math.hypot(pose.position[0] - 1, pose.position[2] + 2)).toBeGreaterThan(0.1 + 0.04);
    // nothing known about its size: still clear of the bag
    const bare = poseBeside({ position: [0, 0, 0] }, 0.1, 3, { object: {}, scale: 1 });
    expect(Math.hypot(bare.position[0], bare.position[2])).toBeGreaterThan(0.1);
    expect(bare.position[1]).toBe(0);
  });
});

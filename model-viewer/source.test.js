import { describe, it, expect } from "vitest";
import { convert3dm, loadRhino } from "./source.js";

describe("3dm → glb", () => {
  it("converts a brep box made with rhino3dm", async () => {
    const rhino = await loadRhino();
    const f = new rhino.File3dm();
    f.settings().modelUnitSystem = rhino.UnitSystem.Millimeters;
    const bbox = new rhino.BoundingBox([0, 0, 0], [1000, 2000, 500]);
    const box = rhino.Brep.createFromBox ? rhino.Brep.createFromBox(new rhino.Box(bbox)) : null;
    if (box) f.objects().add(box, null);
    const sphere = new rhino.Sphere([0, 0, 0], 100);
    f.objects().addSphere(sphere, null);
    const bytes = f.toByteArray();
    const r = await convert3dm(bytes, {}, "t");
    expect(r.kind).toBe("glb");
    expect(r.glb.byteLength).toBeGreaterThan(100);
    expect(r.meta.notes).toContain("2 objects");
    expect(r.meta.bounds).toBeTruthy();
    // mm → m, Z-up → Y-up: box is 500 mm tall
    expect(r.meta.bounds.max[1]).toBeCloseTo(0.5, 3);
  }, 60000);
});

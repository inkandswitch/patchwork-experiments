import { describe, it, expect } from "vitest";
import { boxTriangles } from "../test/box.js";
import { prepareHull, weld, orient, closeHoles, edgeStats, signedVolume, hydrostatics, sinkageForVolume, encodeSTL, decodeSTL, applyAttitude, clipBelow, flipAll } from "./prepare.js";

describe("the box hull", () => {
  it("measures exactly", () => {
    const { info, warnings } = prepareHull(boxTriangles());
    expect(warnings).toEqual([]);
    expect(info.closed).toBe(true);
    expect(info.symmetric).toBe(true);
    expect(info.volume).toBeCloseTo(2, 12);
    expect(info.wettedArea).toBeCloseTo(9, 12);
    expect(info.lcb).toBeCloseTo(2, 12);
    expect(info.lwl).toBeCloseTo(4, 12);
    expect(info.bwl).toBeCloseTo(1, 12);
    expect(info.draft).toBeCloseTo(0.5, 12);
    // the waterplane: 4 × 1, centred at x = 2, I_L = b·L³/12
    expect(info.awp).toBeCloseTo(4, 12);
    expect(info.lcf).toBeCloseTo(2, 12);
    expect(info.il).toBeCloseTo(64 / 12, 12);
  });
  it("finds the waterplane of a trimmed hull about its own centre", () => {
    // trimmed 2° about mid-length: the waterline lengthens by 1/cos and the centre stays put (a box is symmetric about it)
    const { info } = prepareHull(boxTriangles(), { trim: 2 });
    const c = Math.cos((2 * Math.PI) / 180);
    expect(info.awp).toBeCloseTo(4 / c, 6);
    expect(info.lcf).toBeCloseTo(2, 6);
    expect(info.il).toBeCloseTo(((4 / c) ** 3) / 12, 4);
  });
  it("closes an open bow and still measures exactly", () => {
    const { info, warnings, mesh } = prepareHull(boxTriangles({ open: true }));
    expect(warnings[0]).toMatch(/closed 1 opening/);
    expect(edgeStats(mesh)).toEqual({ boundary: 0, manifold: mesh.faces.length / 2, nonManifold: 0 });
    expect(info.volume).toBeCloseTo(2, 12);
    expect(info.wettedArea).toBeCloseTo(9, 12);
  });
  it("comes out wound outward whichever way it went in", () => {
    const w = weld(boxTriangles(), 1e-9);
    const inward = flipAll(w);
    expect(signedVolume(w)).toBeCloseTo(4, 12);
    expect(signedVolume(inward)).toBeCloseTo(-4, 12);
    expect(prepareHull(boxTriangles()).info.volume).toBeCloseTo(2, 12);
  });
  it("re-winds a face that disagrees with its neighbours", () => {
    const w = weld(boxTriangles(), 1e-9);
    const faces = Uint32Array.from(w.faces);
    [faces[1], faces[2]] = [faces[2], faces[1]]; // flip one face
    const o = orient({ points: w.points, faces });
    expect(o.conflicts).toBe(0);
    // the walk starts at face 0, the odd one out, so it flips the other 11 to agree with it
    // (which way round is settled afterwards, by the volume's sign)
    expect(Math.min(o.flipped, 12 - o.flipped)).toBe(1);
    expect(Math.abs(signedVolume(o))).toBeCloseTo(4, 12);
  });
  it("fills each opening with faces wound to match", () => {
    const open = orient(weld(boxTriangles({ open: true }), 1e-9));
    expect(edgeStats(open).boundary).toBe(4);
    const closed = closeHoles(open);
    expect(closed.loops).toHaveLength(1);
    expect(closed.loops[0].edges).toBe(4);
    expect(orient(closed).flipped).toBe(0); // already consistent
    expect(signedVolume(closed)).toBeCloseTo(4, 12);
  });
  it("sinks to a displacement by bisection", () => {
    expect(sinkageForVolume(boxTriangles(), 3)).toBeCloseTo(0.25, 9); // 4 × 1 × 0.75
    expect(sinkageForVolume(boxTriangles(), 1)).toBeCloseTo(-0.25, 9);
    expect(sinkageForVolume(boxTriangles(), 5)).toBe(null); // more than the whole box
  });
  it("trims about mid-length, bow down for positive trim, keeping the volume", () => {
    const t = applyAttitude(boxTriangles(), { trim: 2 }, 2);
    const { info } = prepareHull(boxTriangles(), { trim: 2 });
    // the bow end (x = 4) has gone down: its lowest point is below −0.5
    let bowZ = Infinity;
    for (let i = 0; i < t.length; i += 3) if (t[i] > 3.9) bowZ = Math.min(bowZ, t[i + 2]);
    expect(bowZ).toBeLessThan(-0.5);
    // a box trimmed about its centre on the waterline displaces the same
    expect(info.volume).toBeCloseTo(2, 9);
  });
  it("warns when the hull misses the water", () => {
    expect(prepareHull(boxTriangles(), { sinkage: 1 }).warnings.join()).toMatch(/wholly under water/);
    expect(prepareHull(boxTriangles(), { sinkage: -1 }).warnings.join()).toMatch(/wholly out of the water/);
  });
});

describe("clipping", () => {
  it("keeps a triangle below, drops one above, cuts one across", () => {
    expect(clipBelow([0, 0, -1], [1, 0, -1], [0, 1, -1])).toHaveLength(3);
    expect(clipBelow([0, 0, 1], [1, 0, 1], [0, 1, 1])).toHaveLength(0);
    const p = clipBelow([0, 0, -1], [1, 0, 1], [0, 1, 1]);
    expect(p).toHaveLength(3);
    expect(p.filter((q) => q[2] === 0)).toHaveLength(2);
    expect(clipBelow([0, 0, 1], [1, 0, -1], [0, 1, -1])).toHaveLength(4);
  });
  it("gives the box's wetted area face by face", () => {
    expect(hydrostatics(closeHoles(orient(weld(boxTriangles(), 1e-9)))).wettedArea).toBeCloseTo(9, 12);
  });
});

describe("STL", () => {
  it("round-trips, and never starts with 'solid' (that reads as ASCII)", () => {
    const { mesh } = prepareHull(boxTriangles());
    const stl = encodeSTL(mesh);
    expect(new TextDecoder().decode(stl.subarray(0, 5))).not.toBe("solid");
    expect(stl.byteLength).toBe(84 + 50 * (mesh.faces.length / 3));
    const back = decodeSTL(stl);
    expect(back.length).toBe(mesh.faces.length * 3);
    expect(prepareHull(back).info.volume).toBeCloseTo(2, 5);
  });
});

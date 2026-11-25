import { encodeSTL, decodeSTL } from "./stl.js";
import { encodePart, decodePart, carryFaces, carrySetup } from "./kept.js";
import { readPart, soup } from "./faces.js";
import { box, plateWithHole, cylinder, placed } from "../test/shapes.js";
import { normalizeSetup } from "../setup.js";

const source = { url: "automerge:abc", title: "bracket", heads: ["h1"], path: "parts/0", providerId: "cad", providerName: "CAD", readAt: 1700000000000 };

describe("binary STL", () => {
  it("round-trips triangles to Float32", () => {
    const tris = plateWithHole(0.1, 0.06, 0.005, 0.01, 16);
    const back = decodeSTL(encodeSTL(tris));
    expect(back.length).toBe(tris.length);
    expect(Array.from(back)).toEqual(Array.from(Float32Array.from(tris)));
  });

  it("is 84 bytes and 50 a triangle, its count at byte 80, each normal unit and outward", () => {
    const bytes = encodeSTL(box(1, 2, 3));
    expect(bytes.byteLength).toBe(84 + 12 * 50);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(80, true)).toBe(12);
    // the first triangle is on z = 0, wound to face −z
    expect([0, 4, 8].map((o) => dv.getFloat32(84 + o, true))).toEqual([0, 0, -1]);
  });

  it("its header never begins 'solid', whatever the part is called", () => {
    for (const name of ["solid", "solid part", "", "x".repeat(200)]) {
      const head = new TextDecoder().decode(encodeSTL(box(1, 1, 1), { name }).subarray(0, 80));
      expect(head.startsWith("solid")).toBe(false);
    }
  });

  it("a collapsed triangle gets a zero normal, not NaN", () => {
    const dv = new DataView(encodeSTL([0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer);
    expect([0, 4, 8].map((o) => dv.getFloat32(84 + o, true))).toEqual([0, 0, 0]);
  });

  it("reads bytes that sit at an offset in a bigger buffer", () => {
    const bytes = encodeSTL(box(1, 2, 3));
    const big = new Uint8Array(bytes.byteLength + 3);
    big.set(bytes, 3);
    expect(Array.from(decodeSTL(big.subarray(3)))).toEqual(Array.from(box(1, 2, 3)));
  });

  it("refuses what is too short, or holds fewer triangles than it says", () => {
    expect(() => decodeSTL(new Uint8Array(10))).toThrow(/too short/);
    const bytes = encodeSTL(box(1, 1, 1));
    expect(() => decodeSTL(bytes.subarray(0, bytes.byteLength - 1))).toThrow(/holds fewer/);
  });
});

describe("encodePart and decodePart", () => {
  for (const [name, tris] of [
    ["a box", box(0.1, 0.02, 0.03)],
    ["a plate with a hole", plateWithHole(0.1, 0.06, 0.005, 0.01, 32)],
    ["a turned cylinder", placed(cylinder(0.01, 0.05, 24), { axis: [1, 0, 0], angle: 1, move: [0.1, 0.2, 0.3] })],
  ])
    it(`${name} comes back the same: triangles in order, faceOf, faces, volume`, () => {
      const part = readPart(tris);
      const kept = encodePart(part, source);
      const back = decodePart(kept);
      expect(Array.from(soup(back))).toEqual(Array.from(soup(part)));
      expect(back.tris.length).toBe(part.tris.length);
      expect(back.positions.length).toBe(part.positions.length);
      expect(Array.from(back.faceOf)).toEqual(Array.from(part.faceOf));
      expect(back.faces).toEqual(part.faces);
      expect(back.volume).toBe(part.volume);
      expect(back.area).toBe(part.area);
      expect(back.box).toEqual(part.box);
      expect(back.diagonal).toBe(part.diagonal);
      expect(back.solid).toBe(true);
      expect(back.title).toBe("bracket");
      expect(back.source).toEqual(source);
    });

  it("what is kept is plain data: bytes and copies, nothing shared with the part", () => {
    const part = readPart(box(1, 1, 1));
    const kept = encodePart(part, source);
    expect(kept.stl).toBeInstanceOf(Uint8Array);
    expect(kept.faceOf).toBeInstanceOf(Uint8Array);
    expect(kept.faceOf.byteLength).toBe(4 * 12);
    kept.faces[0].centroid[0] = 99;
    expect(part.faces[0].centroid[0]).not.toBe(99);
    const back = decodePart(kept);
    back.faces[1].normal[0] = 99;
    expect(kept.faces[1].normal[0]).not.toBe(99);
  });

  it("reads faceOf bytes that aren't 4-aligned, and bytes given as a plain array", () => {
    const kept = encodePart(readPart(box(1, 1, 1)), source);
    const big = new Uint8Array(kept.faceOf.byteLength + 1);
    big.set(kept.faceOf, 1);
    const back = decodePart({ ...kept, faceOf: big.subarray(1), stl: Array.from(kept.stl) });
    expect(Array.from(back.faceOf)).toEqual(Array.from(readPart(box(1, 1, 1)).faceOf));
  });

  it("refuses a part that isn't there, or whose faces don't match its triangles", () => {
    expect(() => decodePart(null)).toThrow(/no part/);
    expect(() => decodePart({ stl: new Uint8Array(84) })).toThrow(/no part/);
    const kept = encodePart(readPart(box(1, 1, 1)), source);
    expect(() => decodePart({ ...kept, faceOf: kept.faceOf.subarray(4) })).toThrow(/don't match/);
  });

  it("a part kept without a source is called 'part'", () => {
    const kept = encodePart(readPart(box(1, 1, 1)), { ...source, title: undefined });
    delete kept.title;
    kept.source = null;
    expect(decodePart(kept).title).toBe("part");
  });
});

describe("carryFaces", () => {
  it("between a part and itself is the identity", () => {
    for (const tris of [box(0.1, 0.02, 0.03), plateWithHole(0.1, 0.06, 0.005, 0.01, 32), cylinder(0.01, 0.05, 32)]) {
      const p = readPart(tris);
      const carried = carryFaces(p, p);
      expect([...carried]).toEqual(p.faces.map((f) => [f.id, f.id]));
    }
  });

  it("between a part and the same part read again after a kept round trip, too", () => {
    const p = readPart(plateWithHole(0.1, 0.06, 0.005, 0.01, 32));
    const q = decodePart(encodePart(p, source));
    expect([...carryFaces(p, q)]).toEqual(p.faces.map((f) => [f.id, f.id]));
  });

  /** old face → the new face it was carried to, by which way each faces. */
  const byFacing = (a, b, carried) => {
    const name = (f) => ["x", "y", "z"].map((k, i) => (f.normal[i] > 0.5 ? `+${k}` : f.normal[i] < -0.5 ? `-${k}` : "")).join("");
    return Object.fromEntries([...carried].map(([o, n]) => [name(a.faces[o]), n == null ? null : name(b.faces[n])]));
  };

  it("a bar made 3% longer: the far end moved more than a fiftieth of the size, so only it is lost", () => {
    // reach: 2% of the diagonal ≈ 2.06 mm. The far end moved 3 mm; the long faces' centres
    // 1.5 mm and their areas 3%; the near end didn't move.
    const a = readPart(box(0.1, 0.01, 0.01)), b = readPart(box(0.103, 0.01, 0.01));
    const carried = carryFaces(a, b);
    expect(byFacing(a, b, carried)).toEqual({ "-x": "-x", "+x": null, "-y": "-y", "+y": "+y", "-z": "-z", "+z": "+z" });
  });

  it("a bar made 20% longer: only the near end is still alike (the long faces grew past a tenth)", () => {
    const a = readPart(box(0.1, 0.01, 0.01)), b = readPart(box(0.12, 0.01, 0.01));
    const carried = carryFaces(a, b);
    expect(byFacing(a, b, carried)).toEqual({ "-x": "-x", "+x": null, "-y": null, "+y": null, "-z": null, "+z": null });
  });

  it("a bar made 1% longer carries every face", () => {
    const a = readPart(box(0.1, 0.01, 0.01)), b = readPart(box(0.101, 0.01, 0.01));
    expect(byFacing(a, b, carryFaces(a, b))).toEqual({ "-x": "-x", "+x": "+x", "-y": "-y", "+y": "+y", "-z": "-z", "+z": "+z" });
  });

  it("a face turned more than 10° isn't alike; less is", () => {
    const face = (deg) => ({ id: 0, flat: true, area: 1, centroid: [0, 0, 0], normal: [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0] });
    const at = (deg) => carryFaces({ diagonal: 10, faces: [face(0)] }, { diagonal: 10, faces: [face(deg)] }).get(0);
    expect(at(9.9)).toBe(0);
    expect(at(10.1)).toBeNull();
    expect(at(180)).toBeNull();
  });

  it("a fiftieth of the larger part's size in position, a tenth of the larger face's area", () => {
    const face = (x, area) => ({ id: 0, flat: true, area, centroid: [x, 0, 0], normal: [1, 0, 0] });
    const at = (x, area) => carryFaces({ diagonal: 10, faces: [face(0, 1)] }, { diagonal: 5, faces: [face(x, area)] }).get(0);
    expect(at(0.199, 1)).toBe(0);
    expect(at(0.201, 1)).toBeNull();
    expect(at(0, 1.11)).toBe(0); // 0.11 of 1.11 is under a tenth
    expect(at(0, 1.12)).toBeNull();
    expect(at(0, 0.91)).toBe(0);
    expect(at(0, 0.89)).toBeNull();
  });

  it("a face with no one direction matches only another with none", () => {
    const face = (normal) => ({ id: 0, flat: false, area: 1, centroid: [0, 0, 0], normal });
    const at = (n, m) => carryFaces({ diagonal: 10, faces: [face(n)] }, { diagonal: 10, faces: [face(m)] }).get(0);
    expect(at([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(at([0, 0, 0], [1, 0, 0])).toBeNull();
    expect(at([1, 0, 0], [0, 0, 0])).toBeNull();
  });

  it("flat and curved never match", () => {
    const a = readPart(cylinder(0.01, 0.05, 32));
    const flatB = { diagonal: a.diagonal, faces: a.faces.map((f) => ({ ...f, flat: !f.flat })) };
    expect([...carryFaces(a, flatB).values()]).toEqual([null, null, null]);
  });

  it("each new face answers for one old face at most: the closest", () => {
    // two old faces alike to the same one new face
    const face = (id, x) => ({ id, flat: true, area: 1, centroid: [x, 0, 0], normal: [1, 0, 0] });
    const old = { diagonal: 100, faces: [face(0, 0.5), face(1, 0.1)] };
    const neu = { diagonal: 100, faces: [face(0, 0)] };
    const carried = carryFaces(old, neu);
    expect(carried.get(1)).toBe(0);
    expect(carried.get(0)).toBeNull();
  });
});

describe("carrySetup", () => {
  it("moves supports and loads onto the new faces, keeps what it can, and says what is lost", () => {
    const a = readPart(box(0.1, 0.01, 0.01)), b = readPart(box(0.103, 0.01, 0.01));
    const carried = carryFaces(a, b);
    const id = (p, n) => p.faces.find((f) => f.normal.every((v, k) => Math.abs(v - n[k]) < 1e-9)).id;
    const near = id(a, [-1, 0, 0]), far = id(a, [1, 0, 0]), top = id(a, [0, 1, 0]);
    const setup = normalizeSetup({
      supports: { s1: { name: "Wall", kind: "fixed", faces: [near] } },
      loads: {
        l1: { name: "Tip", kind: "force", faces: [far, top], magnitude: { value: 1, unit: "kN" }, direction: [0, -1, 0] },
        l2: { name: "Weight", kind: "gravity", acceleration: { value: 1, unit: "g" }, direction: [0, -1, 0] },
      },
    });
    const out = carrySetup(setup, carried);
    expect(out.supports.s1.faces).toEqual([id(b, [-1, 0, 0])]);
    expect(out.loads.l1.faces).toEqual([id(b, [0, 1, 0])]);
    expect(out.loads.l1.magnitude).toEqual({ value: 1, unit: "kN" });
    // gravity has no faces: untouched
    expect(out.loads.l2).toBe(setup.loads.l2);
    expect(out.lost).toEqual([{ what: "load", id: "l1", name: "Tip", faces: 1 }]);
  });

  it("two old faces carried onto the same new one are listed once", () => {
    const carried = new Map([[0, 5], [1, 5], [2, 3]]);
    const out = carrySetup({ supports: { s: { name: "S", kind: "fixed", faces: [0, 1, 2] } }, loads: {} }, carried);
    expect(out.supports.s.faces).toEqual([3, 5]);
    expect(out.lost).toEqual([]);
  });

  it("a face the carry doesn't know at all is lost too", () => {
    const out = carrySetup({ supports: { s: { name: "S", kind: "fixed", faces: [7] } }, loads: {} }, new Map());
    expect(out.supports.s.faces).toEqual([]);
    expect(out.lost).toEqual([{ what: "support", id: "s", name: "S", faces: 1 }]);
  });

  it("the setup given isn't changed", () => {
    const setup = { supports: { s: { name: "S", kind: "fixed", faces: [0] } }, loads: {} };
    carrySetup(setup, new Map([[0, 4]]));
    expect(setup.supports.s.faces).toEqual([0]);
  });
});

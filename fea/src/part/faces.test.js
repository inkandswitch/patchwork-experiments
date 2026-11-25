import { weld, edgeTwins, readPart, soup, extent, areaNormals, facingWord, describeFace, SHARP_DEG, BROAD_RATIO } from "./faces.js";
import { box, cylinder, plateWithHole, filleted, ball, placed } from "../test/shapes.js";

const f32 = Math.fround;
/** A triangle soup with these triangles' windings turned (vertices 1 and 2 swapped). */
const flipping = (tris, which) => {
  const out = Float64Array.from(tris);
  for (const t of which)
    for (let k = 0; k < 3; k++) {
      out[t * 9 + 3 + k] = tris[t * 9 + 6 + k];
      out[t * 9 + 6 + k] = tris[t * 9 + 3 + k];
    }
  return out;
};
/** A soup's triangles in the reverse order, each one as it was. */
const reversed = (tris) => {
  const T = tris.length / 9;
  const out = new Float64Array(tris.length);
  for (let t = 0; t < T; t++) out.set(tris.subarray((T - 1 - t) * 9, (T - t) * 9), t * 9);
  return out;
};
const faceSummary = (part) => part.faces.map((f) => ({ id: f.id, triangles: f.triangles, area: f.area, centroid: f.centroid, normal: f.normal, flat: f.flat, radius: f.radius }));

describe("weld", () => {
  it("makes exactly equal corners one vertex", () => {
    const w = weld(box(1, 2, 3));
    expect(w.positions.length / 3).toBe(8);
    expect(w.tris.length / 3).toBe(12);
    expect(w.dropped).toBe(0);
  });

  /** A box whose corner 0 is written a little off where triangle `t` names it. */
  const nudged = (d, t = 0) => {
    const tris = box(1, 1, 1);
    tris[t * 9] += d;
    return tris;
  };

  it("makes corners within the tolerance one, and leaves those past it apart", () => {
    expect(weld(nudged(1e-9), { tol: 1e-8 }).positions.length / 3).toBe(8);
    expect(weld(nudged(1e-9), { tol: 1e-10 }).positions.length / 3).toBe(9);
    // the default tolerance is a millionth of the diagonal (√3 here)
    expect(weld(nudged(1e-7)).positions.length / 3).toBe(8);
    expect(weld(nudged(1e-5)).positions.length / 3).toBe(9);
    // the first corner written is the one kept
    expect(Array.from(weld(nudged(1e-9), { tol: 1e-8 }).positions.slice(0, 3))).toEqual([1e-9, 0, 0]);
  });

  it("welds across a cell boundary of its grid", () => {
    // the cells are 2·tol wide and meet at x = 0: corners 0.4·tol either side of it are one
    const tol = 1e-3;
    const tris = box(1, 1, 1);
    const first = tris.findIndex((v, i) => i % 3 === 0 && v === 0);
    tris[first] = -0.4e-3;
    tris[tris.findIndex((v, i) => i > first && i % 3 === 0 && v === 0 && tris[i + 1] === tris[first + 1] && tris[i + 2] === tris[first + 2])] = 0.4e-3;
    expect(weld(tris, { tol }).positions.length / 3).toBe(8);
  });

  it("drops triangles that collapse, and says how many", () => {
    // a box with two extra triangles: one whose corners weld to two, one that is a point
    const tris = Float64Array.from([...box(1, 1, 1), 0, 0, 0, 1e-12, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const w = weld(tris);
    expect(w.tris.length / 3).toBe(12);
    expect(w.dropped).toBe(2);
    expect(w.positions.length / 3).toBe(8);
  });

  // an open sheet has more vertices than triangles: every one is kept (three numbers a vertex)
  it("keeps every vertex of a soup with more vertices than triangles", () => {
    const w = weld([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(w.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });

  it("welds the shared corners of an open square (two triangles, four vertices)", () => {
    const w = weld([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(w.positions.length / 3).toBe(4);
    expect(Array.from(w.tris)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("drops a triangle that is a point even where the soup is sparse", () => {
    const w = weld([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect(w.tris.length / 3).toBe(1);
    expect(w.dropped).toBe(1);
  });

  it("exact: only identical corners are one; every triangle kept, in order", () => {
    const tris = [0, 0, 0, 1, 0, 0, 0, 1, 0, /* collapsed: */ 0, 0, 0, 1e-12, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    const w = weld(tris, { exact: true });
    expect(w.tris.length / 3).toBe(3);
    expect(w.dropped).toBe(0);
    expect(w.positions.length / 3).toBe(5);
    expect(Array.from(soup(w))).toEqual(tris);
  });

  it("ignores a trailing part-triangle", () => {
    expect(weld([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5]).tris.length).toBe(3);
  });
});

describe("edgeTwins", () => {
  it("on a closed box every half-edge has a twin, which runs the other way and whose twin it is", () => {
    const w = weld(box(1, 2, 3));
    const { twin, open, crowded } = edgeTwins(w);
    expect(open).toBe(0);
    expect(crowded).toBe(0);
    for (let h = 0; h < twin.length; h++) {
      const g = twin[h];
      expect(g).toBeGreaterThanOrEqual(0);
      expect(twin[g]).toBe(h);
      expect(Math.floor(g / 3)).not.toBe(Math.floor(h / 3));
      const next = (x) => x - (x % 3) + ((x + 1) % 3);
      expect(w.tris[g]).toBe(w.tris[next(h)]);
      expect(w.tris[next(g)]).toBe(w.tris[h]);
    }
  });

  it("an open edge is −1 and counted", () => {
    const w = weld(box(1, 1, 1).slice(0, 10 * 9));
    const { twin, open } = edgeTwins(w);
    expect(open).toBe(4);
    expect([...twin].filter((h) => h === -1).length).toBe(4);
  });

  it("an edge three triangles share is crowded: −2 on all three, counted once", () => {
    const positions = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]);
    const tris = Uint32Array.from([0, 1, 2, 1, 0, 3, 0, 1, 4]);
    const { twin, crowded } = edgeTwins({ positions, tris });
    expect(crowded).toBe(1);
    expect([twin[0], twin[3], twin[6]]).toEqual([-2, -2, -2]);
    // a fourth on the same edge is still one crowded edge
    const four = edgeTwins({ positions: Float64Array.from([...positions, 0, 0, -1]), tris: Uint32Array.from([...tris, 1, 0, 5]) });
    expect(four.crowded).toBe(1);
    expect(four.twin[9]).toBe(-2);
  });
});

describe("readPart: a box", () => {
  const [lx, ly, lz] = [0.1, 0.02, 0.03];
  const part = readPart(box(lx, ly, lz));

  it("is one solid of six flat faces, two triangles each", () => {
    expect(part.solid).toBe(true);
    expect(part.problems).toEqual([]);
    expect(part.notes).toEqual([]);
    expect(part.faces.length).toBe(6);
    for (const f of part.faces) {
      expect(f.flat).toBe(true);
      expect(f.triangles).toBe(2);
      expect(f.radius).toBeNull();
    }
    expect(part.faces.map((f) => f.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("its volume, area and box are the box's, at Float32", () => {
    const [x, y, z] = [f32(lx), f32(ly), f32(lz)];
    expect(part.volume / (x * y * z)).toBeCloseTo(1, 14);
    expect(part.area / (2 * (x * y + y * z + z * x))).toBeCloseTo(1, 14);
    expect(part.box).toEqual({ min: [0, 0, 0], max: [x, y, z] });
    expect(part.diagonal).toBeCloseTo(Math.hypot(x, y, z), 15);
  });

  it("its faces face the six axis directions, each its own side's area and centre", () => {
    const [x, y, z] = [f32(lx), f32(ly), f32(lz)];
    const want = [
      { normal: [-1, 0, 0], area: y * z, centroid: [0, y / 2, z / 2] },
      { normal: [1, 0, 0], area: y * z, centroid: [x, y / 2, z / 2] },
      { normal: [0, -1, 0], area: x * z, centroid: [x / 2, 0, z / 2] },
      { normal: [0, 1, 0], area: x * z, centroid: [x / 2, y, z / 2] },
      { normal: [0, 0, -1], area: x * y, centroid: [x / 2, y / 2, 0] },
      { normal: [0, 0, 1], area: x * y, centroid: [x / 2, y / 2, z] },
    ];
    for (const w of want) {
      const f = part.faces.find((f) => w.normal.every((v, k) => Math.abs(f.normal[k] - v) < 1e-12));
      expect(f).toBeDefined();
      expect(f.area / w.area).toBeCloseTo(1, 12);
      for (let k = 0; k < 3; k++) expect(f.centroid[k]).toBeCloseTo(w.centroid[k], 12);
    }
  });

  it("faceOf gives every triangle its face", () => {
    expect(part.faceOf.length).toBe(12);
    const n = new Array(6).fill(0);
    for (const f of part.faceOf) n[f]++;
    expect(n).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it("soup gives back its triangles", () => {
    expect(Array.from(soup(part))).toEqual(Array.from(Float32Array.from(box(lx, ly, lz))));
  });
});

describe("readPart: what it puts right and what it can't", () => {
  it("a box with one face left out isn't solid, and says how many edges are open", () => {
    const p = readPart(box(1, 1, 1).slice(18));
    expect(p.solid).toBe(false);
    expect(p.volume).toBe(0);
    expect(p.problems).toEqual(["its surface isn't closed: 4 edges have a face on one side only"]);
  });

  it("a box with some triangles wound backwards comes out the same, and says how many it turned", () => {
    const good = readPart(box(0.1, 0.02, 0.03));
    for (const which of [[3], [3, 7], [0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
      const p = readPart(flipping(box(0.1, 0.02, 0.03), which));
      expect(p.solid).toBe(true);
      expect(p.volume).toBe(good.volume);
      expect(faceSummary(p)).toEqual(faceSummary(good));
      expect(Array.from(p.faceOf)).toEqual(Array.from(good.faceOf));
      expect(p.notes).toEqual([`${which.length} triangle${which.length === 1 ? " was" : "s were"} wound backwards and turned`]);
    }
  });

  it("a box wound inside out entirely is turned whole", () => {
    const p = readPart(flipping(box(1, 1, 1), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
    expect(p.volume).toBeCloseTo(1, 12);
    expect(p.notes).toEqual(["12 triangles were wound backwards and turned"]);
  });

  it("of two separate boxes, the larger is taken, in either order, and a note says so", () => {
    const big = box(0.1, 0.1, 0.1), small = placed(box(0.05, 0.05, 0.05), { move: [1, 0, 0] });
    for (const tris of [Float64Array.from([...big, ...small]), Float64Array.from([...small, ...big])]) {
      const p = readPart(tris);
      expect(p.solid).toBe(true);
      expect(p.faces.length).toBe(6);
      expect(p.volume).toBeCloseTo(f32(0.1) ** 3, 15);
      expect(p.tris.length / 3).toBe(12);
      expect(p.positions.length / 3).toBe(8);
      expect(p.box.max[0]).toBe(f32(0.1));
      expect(p.notes).toEqual(["it is 2 separate pieces: the largest is analysed, the other is left out"]);
    }
  });

  it("three pieces: the note counts the other two", () => {
    const p = readPart(Float64Array.from([...box(1, 1, 1), ...placed(box(0.5, 0.5, 0.5), { move: [3, 0, 0] }), ...placed(box(0.5, 0.5, 0.5), { move: [6, 0, 0] })]));
    expect(p.notes).toEqual(["it is 3 separate pieces: the largest is analysed, the other 2 are left out"]);
  });

  it("no triangles: no surface", () => {
    const p = readPart([]);
    expect(p.solid).toBe(false);
    expect(p.problems).toEqual(["it has no surface: no triangles"]);
  });

  it("collapsed triangles are left out with a note", () => {
    const p = readPart(Float64Array.from([...box(1, 1, 1), 0, 0, 0, 0, 0, 0, 1, 1, 1]));
    expect(p.solid).toBe(true);
    expect(p.notes).toEqual(["1 triangle with no area left out"]);
  });

  // a box with one more triangle hung on an edge (a fin): three faces meet there, and that is what it says
  it("a fin on a box (three faces on an edge) is named as that", () => {
    const p = readPart(Float64Array.from([...box(1, 1, 1), 0, 0, 0, 1, 0, 0, 0.5, -1, 0.5]));
    expect(p.solid).toBe(false);
    expect(p.problems).toEqual(["its surface isn't a simple closed skin: more than two faces meet along 1 edge"]);
  });

  it("a fin on a box isn't solid", () => {
    const p = readPart(Float64Array.from([...box(1, 1, 1), 0, 0, 0, 1, 0, 0, 0.5, -1, 0.5]));
    expect(p.solid).toBe(false);
    expect(p.problems.length).toBe(1);
  });
});

describe("readPart: curved faces", () => {
  it("a cylinder is two flat caps and one round side of its radius", () => {
    const r = 0.01, h = 0.05;
    const p = readPart(cylinder(r, h, 32));
    expect(p.solid).toBe(true);
    expect(p.faces.length).toBe(3);
    const flat = p.faces.filter((f) => f.flat);
    expect(flat.length).toBe(2);
    expect(flat.map((f) => f.normal[2]).sort()).toEqual([-1, 1]);
    const side = p.faces.find((f) => !f.flat);
    expect(side.triangles).toBe(64);
    expect(Math.abs(side.radius / r - 1)).toBeLessThan(0.01);
    // a tube closes round on itself: no one direction
    expect(side.normal).toEqual([0, 0, 0]);
  });

  it("a plate with a hole is seven faces, the hole's wall one round face of its radius", () => {
    const r = 0.01;
    const p = readPart(plateWithHole(0.1, 0.06, 0.005, r, 32));
    expect(p.solid).toBe(true);
    expect(p.faces.length).toBe(7);
    const round = p.faces.filter((f) => !f.flat);
    expect(round.length).toBe(1);
    expect(Math.abs(round[0].radius / r - 1)).toBeLessThan(0.01);
    expect(round[0].triangles).toBe(64);
    for (const f of p.faces.filter((f) => f.flat)) expect(f.radius).toBeNull();
  });

  it("a fillet is one round face, and the broad flats it runs smoothly into stay their own", () => {
    const [lx, ly, lz, radius, steps] = [0.05, 0.05, 0.02, 0.005, 6];
    const p = readPart(filleted(lx, ly, lz, radius, steps));
    expect(p.solid).toBe(true);
    // bottom, two sides, top, two ends, the fillet
    expect(p.faces.length).toBe(7);
    const fillet = p.faces.filter((f) => !f.flat);
    expect(fillet.length).toBe(1);
    expect(fillet[0].triangles).toBe(2 * steps);
    expect(Math.abs(fillet[0].radius / radius - 1)).toBeLessThan(0.01);
    const top = p.faces.find((f) => f.normal[1] > 0.999);
    const side = p.faces.find((f) => f.normal[0] > 0.999);
    expect(top.flat && side.flat).toBe(true);
    expect(top.area / (f32(lx - radius) * f32(lz))).toBeCloseTo(1, 5);
    expect(side.area / (f32(ly - radius) * f32(lz))).toBeCloseTo(1, 5);
    // the top meets the fillet's first strip at 90°/steps/2, well within SHARP_DEG: only BROAD_RATIO keeps it apart
    expect(90 / steps / 2).toBeLessThan(SHARP_DEG);
    const strip = fillet[0].area / steps;
    expect(top.area).toBeGreaterThan(BROAD_RATIO * strip);
  });

  it("without the broad rule the fillet swallows the flats it meets smoothly", () => {
    const p = readPart(filleted(0.05, 0.05, 0.02, 0.005, 6), { broadRatio: Infinity });
    // top, fillet and side are one face now: bottom, x = 0 side, two ends, and that
    expect(p.faces.length).toBe(5);
  });

  it("a ball is exactly one face with no one direction, and solid", () => {
    const p = readPart(ball(0.02, 16));
    expect(p.solid).toBe(true);
    expect(p.faces.length).toBe(1);
    expect(p.faces[0].normal).toEqual([0, 0, 0]);
    expect(p.faces[0].flat).toBe(false);
    expect(p.faceOf.every((f) => f === 0)).toBe(true);
  });
});

describe("readPart: face numbers", () => {
  it("don't depend on the order the triangles came in", () => {
    const tris = plateWithHole(0.1, 0.06, 0.005, 0.01, 32);
    const a = readPart(tris), b = readPart(reversed(tris));
    expect(b.faces.length).toBe(a.faces.length);
    // the same faces, to the rounding of adding their triangles up in another order
    a.faces.forEach((f, i) => {
      const g = b.faces[i];
      expect([g.id, g.triangles, g.flat]).toEqual([f.id, f.triangles, f.flat]);
      expect(g.area / f.area).toBeCloseTo(1, 12);
      for (let k = 0; k < 3; k++) expect(g.centroid[k]).toBeCloseTo(f.centroid[k], 12);
      for (let k = 0; k < 3; k++) expect(g.normal[k]).toBeCloseTo(f.normal[k], 12);
      if (f.radius) expect(g.radius / f.radius).toBeCloseTo(1, 9);
      else expect(g.radius).toBeNull();
    });
    // the same triangle is on the same face either way
    const faceAt = (p) => {
      const map = new Map();
      const s = soup(p);
      for (let t = 0; t < p.faceOf.length; t++) {
        const pts = [0, 1, 2].map((j) => Array.from(s.subarray(t * 9 + j * 3, t * 9 + j * 3 + 3)).join(",")).sort().join("|");
        map.set(pts, p.faceOf[t]);
      }
      return map;
    };
    const A = faceAt(a), B = faceAt(b);
    expect(A.size).toBe(B.size);
    for (const [k, f] of A) expect(B.get(k)).toBe(f);
  });

  it("a box turned and moved has the same faces' areas, and faceOf partitions its triangles", () => {
    const axis = [1, 2, 3].map((v) => v / Math.hypot(1, 2, 3));
    const p = readPart(placed(box(0.1, 0.02, 0.03), { axis, angle: 0.7, move: [0.3, -0.2, 0.5] }));
    const q = readPart(box(0.1, 0.02, 0.03));
    expect(p.solid).toBe(true);
    expect(p.faces.length).toBe(6);
    const areas = (x) => x.faces.map((f) => f.area).sort((a, b) => a - b);
    areas(p).forEach((a, i) => expect(a / areas(q)[i]).toBeCloseTo(1, 5));
    const n = new Array(p.faces.length).fill(0);
    for (const f of p.faceOf) n[f]++;
    expect(n).toEqual(p.faces.map((f) => f.triangles));
    expect(n.reduce((a, b) => a + b, 0)).toBe(p.tris.length / 3);
    for (const f of p.faces) expect(Math.hypot(...f.normal)).toBeCloseTo(1, 12);
  });
});

describe("small helpers", () => {
  it("extent of nothing is a point at the origin", () => {
    expect(extent([])).toEqual({ min: [0, 0, 0], max: [0, 0, 0], diagonal: 0 });
    expect(extent([1, 2, 3, -1, 5, 0]).diagonal).toBeCloseTo(Math.hypot(2, 3, 3), 15);
  });

  it("areaNormals: each triangle's normal is twice its area long", () => {
    const n = areaNormals({ positions: Float64Array.from([0, 0, 0, 2, 0, 0, 0, 3, 0]), tris: Uint32Array.from([0, 1, 2]) });
    expect(Array.from(n)).toEqual([0, 0, 6]);
  });

  it("facingWord names an axis within 10°, else nothing", () => {
    expect(facingWord([0, -1, 0])).toBe("−y");
    expect(facingWord([Math.cos(0.1), Math.sin(0.1), 0])).toBe("+x");
    expect(facingWord([Math.SQRT1_2, Math.SQRT1_2, 0])).toBe("");
    expect(facingWord([0, 0, 0])).toBe("");
  });

  it("describeFace says flat, round or curved, its two larger sizes, and which way it faces", () => {
    const mm = (x) => `${Math.round(x * 1000)} mm`;
    const p = readPart(box(0.04, 0.02, 0.01));
    const top = p.faces.find((f) => f.normal[2] > 0.5);
    expect(describeFace(top, mm)).toBe("flat, 40 mm × 20 mm, facing +z");
    const c = readPart(cylinder(0.01, 0.05, 32));
    const side = c.faces.find((f) => !f.flat);
    expect(describeFace(side, mm)).toBe("round, radius 10 mm, 50 mm × 20 mm");
    const b = readPart(ball(0.02, 16));
    expect(describeFace(b.faces[0], mm)).toBe("curved, 40 mm × 40 mm");
  });
});

describe("the test shapes (src/test/shapes.js)", () => {
  it("box, cylinder, plate with a hole and ball come wound outward, as its header says: nothing turned", () => {
    for (const tris of [box(1, 2, 3), cylinder(0.01, 0.05, 32), plateWithHole(0.1, 0.06, 0.005, 0.01, 32), ball(0.02, 16)]) expect(readPart(tris).notes).toEqual([]);
  });

  // (filleted's walls too)
  it("filleted comes wound outward too", () => {
    expect(readPart(filleted(0.05, 0.05, 0.02, 0.005, 6)).notes).toEqual([]);
  });
});

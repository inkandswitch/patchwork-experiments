import { triangleIntegrals, skinOn, nodesOf, volumeShares, applySetup } from "./loads.js";
import { finishMesh } from "./mesh.js";
import { tetBox, partOf } from "../test/tetbox.js";
import { box } from "../test/shapes.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe("triangleIntegrals", () => {
  // a triangle in the plane z = 1, area 3, wound to face +z
  const A = [0, 0, 1], B = [3, 0, 1], C = [0, 2, 1];
  const mid = (P, Q) => P.map((v, k) => (v + Q[k]) / 2);
  const X6 = Float64Array.from([...A, ...B, ...C, ...mid(A, B), ...mid(B, C), ...mid(C, A)]);

  it("a straight six-node triangle: nothing at the corners, a third of its area at each mid-edge node", () => {
    const I = triangleIntegrals(X6, [0, 1, 2, 3, 4, 5]);
    expect(I.area).toBeCloseTo(3, 14);
    expect(I.normal).toEqual([expect.closeTo(0, 14), expect.closeTo(0, 14), expect.closeTo(3, 14)]);
    [0, 0, 0, 1, 1, 1].forEach((w, i) => {
      expect(I.scalar[i]).toBeCloseTo(w, 14);
      expect(I.vector[i * 3]).toBeCloseTo(0, 14);
      expect(I.vector[i * 3 + 1]).toBeCloseTo(0, 14);
      expect(I.vector[i * 3 + 2]).toBeCloseTo(w, 14);
    });
    expect(I.scalar.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 14);
  });

  it("a three-node triangle: a third at each corner", () => {
    const I = triangleIntegrals(X6, [0, 1, 2]);
    expect(I.area).toBeCloseTo(3, 14);
    for (let i = 0; i < 3; i++) {
      expect(I.scalar[i]).toBeCloseTo(1, 14);
      expect(I.vector[i * 3 + 2]).toBeCloseTo(1, 14);
    }
  });

  it("wound the other way, the normal turns and the area doesn't", () => {
    const I = triangleIntegrals(X6, [0, 2, 1, 5, 4, 3]);
    expect(I.area).toBeCloseTo(3, 14);
    expect(I.normal[2]).toBeCloseTo(-3, 14);
    expect(I.scalar[3]).toBeCloseTo(1, 14);
  });

  it("a curved six-node triangle: more area than flat, and ∫n dA what its edges make it", () => {
    // the mid node of edge AB lifted 0.5 off the plane, the one of BC pushed sideways
    const X = Float64Array.from(X6);
    X[3 * 3 + 2] += 0.5;
    X[4 * 3] += 0.2;
    const I = triangleIntegrals(X, [0, 1, 2, 3, 4, 5]);
    expect(I.area).toBeGreaterThan(3);
    // the shape functions sum to one, so the nodes' shares add up to the whole
    expect(I.scalar.reduce((a, b) => a + b, 0)).toBeCloseTo(I.area, 12);
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let i = 0; i < 6; i++) s += I.vector[i * 3 + k];
      expect(s).toBeCloseTo(I.normal[k], 12);
    }
    // ∫n dA over a patch is ½ ∮ x × dx round its edge. Each edge is a parabola through
    // its corners and mid node; x × x′ is a cubic in t, which three Gauss points do exactly.
    const P = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
    const loop = [[0, 1, 3], [1, 2, 4], [2, 0, 5]];
    const g = [[0.5 - Math.sqrt(0.15), 5 / 18], [0.5, 8 / 18], [0.5 + Math.sqrt(0.15), 5 / 18]];
    const want = [0, 0, 0];
    for (const [a, b, m] of loop) {
      const [Pa, Pb, Pm] = [P(a), P(b), P(m)];
      for (const [t, w] of g) {
        const x = [0, 1, 2].map((k) => Pa[k] * (1 - t) * (1 - 2 * t) + Pb[k] * t * (2 * t - 1) + 4 * Pm[k] * t * (1 - t));
        const dx = [0, 1, 2].map((k) => Pa[k] * (4 * t - 3) + Pb[k] * (4 * t - 1) + 4 * Pm[k] * (1 - 2 * t));
        const c = cross(x, dx);
        for (let k = 0; k < 3; k++) want[k] += 0.5 * w * c[k];
      }
    }
    for (let k = 0; k < 3; k++) expect(I.normal[k]).toBeCloseTo(want[k], 12);
  });
});

describe("volumeShares", () => {
  it("a single straight ten-node tetrahedron: −V/20 at each corner, V/5 at each mid-edge node", () => {
    const corners = [0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4];
    const X = [...corners];
    for (const [a, b] of [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]]) for (let k = 0; k < 3; k++) X.push((corners[a * 3 + k] + corners[b * 3 + k]) / 2);
    const V = (2 * 3 * 4) / 6;
    const s = volumeShares({ nodes: Float64Array.from(X), tets: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), per: 10 });
    for (let k = 0; k < 4; k++) expect(s[k]).toBeCloseTo(-V / 20, 14);
    for (let k = 4; k < 10; k++) expect(s[k]).toBeCloseTo(V / 5, 14);
  });

  for (const order of [1, 2])
    it(`order ${order}: the shares sum to the volume${order === 1 ? ", and every one is positive" : ""}`, () => {
      const size = [0.2, 0.1, 0.05];
      const mesh = finishMesh(tetBox(2, 3, 2, size, order), { method: "faces", part: partOf(box(...size)) });
      const s = volumeShares(mesh);
      expect(s.length).toBe(mesh.nodes.length / 3);
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(0.2 * 0.1 * 0.05, 15);
      if (order === 1) for (const v of s) expect(v).toBeGreaterThan(0);
    });
});

describe("applySetup", () => {
  const size = [0.2, 0.1, 0.05];
  const [lx, ly, lz] = size;
  const part = partOf(box(...size));
  const faceFacing = (n) => part.faces.find((f) => n.every((v, k) => Math.abs(f.normal[k] - v) < 1e-9));
  const end = faceFacing([1, 0, 0]), wall = faceFacing([-1, 0, 0]), top = faceFacing([0, 1, 0]), front = faceFacing([0, 0, 1]);
  const meshOf = (order, cells = [2, 2, 2]) => finishMesh(tetBox(...cells, size, order), { method: "faces", part });
  const sum = (nodal) => {
    const s = [0, 0, 0];
    for (const f of nodal.values()) for (let k = 0; k < 3; k++) s[k] += f[k];
    return s;
  };

  for (const order of [1, 2]) {
    describe(`order ${order}`, () => {
      const mesh = meshOf(order);
      const X = mesh.nodes;
      const cornerCount = 3 * 3 * 3;

      it("a force on a face: nodal forces on that face's nodes only, adding up to it", () => {
        const a = applySetup(mesh, { supports: [], loads: [{ id: "f", name: "Push", kind: "force", faces: [end.id], force: [0, -100, 0] }] });
        expect(a.problems).toEqual([]);
        const s = sum(a.nodal);
        expect(Math.abs(s[0])).toBeLessThan(1e-9);
        expect(Math.abs(s[1] + 100)).toBeLessThan(1e-9);
        expect(Math.abs(s[2])).toBeLessThan(1e-9);
        for (const n of a.nodal.keys()) expect(X[n * 3]).toBeCloseTo(lx, 15);
        expect(a.loads).toHaveLength(1);
        expect(a.loads[0].area).toBeCloseTo(ly * lz, 14);
        expect(a.loads[0].total[1]).toBeCloseTo(-100, 9);
        // a uniform load on six-node triangles puts nothing on their corners
        if (order === 2) for (const [n, f] of a.nodal) if (n < cornerCount) expect(Math.hypot(...f)).toBeLessThan(1e-12);
        if (order === 1) for (const f of a.nodal.values()) expect(f[1]).toBeLessThan(0);
      });

      it("a force on two faces is spread over both by area", () => {
        const a = applySetup(mesh, { supports: [], loads: [{ id: "f", name: "Push", kind: "force", faces: [end.id, top.id], force: [10, 20, 30] }] });
        const s = sum(a.nodal);
        [10, 20, 30].forEach((v, k) => expect(s[k]).toBeCloseTo(v, 10));
        expect(a.loads[0].area).toBeCloseTo(ly * lz + lx * lz, 14);
        // the share on the top: its area's fraction
        let onTop = 0;
        for (const [n, f] of a.nodal) if (Math.abs(X[n * 3 + 1] - ly) < 1e-12 && Math.abs(X[n * 3] - lx) > 1e-12) onTop += f[0];
        expect(onTop).toBeLessThan((10 * lx * lz) / (ly * lz + lx * lz) + 1e-9);
      });

      it("a pressure p on a face totals −p·A·n", () => {
        const p = 2e6;
        const a = applySetup(mesh, { supports: [], loads: [{ id: "p", name: "P", kind: "pressure", faces: [top.id], pressure: p }] });
        const s = sum(a.nodal);
        expect(s[0]).toBeCloseTo(0, 6);
        expect(s[1] / (-p * lx * lz)).toBeCloseTo(1, 12);
        expect(s[2]).toBeCloseTo(0, 6);
        expect(a.loads[0].total[1] / (-p * lx * lz)).toBeCloseTo(1, 12);
        for (const n of a.nodal.keys()) expect(X[n * 3 + 1]).toBeCloseTo(ly, 15);
      });

      it("a pressure over every face sums to nothing", () => {
        const a = applySetup(mesh, { supports: [], loads: [{ id: "p", name: "P", kind: "pressure", faces: part.faces.map((f) => f.id), pressure: 1e6 }] });
        for (const v of sum(a.nodal)) expect(Math.abs(v)).toBeLessThan(1e-6);
        expect(a.loads[0].area).toBeCloseTo(2 * (lx * ly + ly * lz + lz * lx), 14);
      });

      it("gravity adds up to one acceleration and puts nothing at the nodes", () => {
        const a = applySetup(mesh, {
          supports: [],
          loads: [
            { id: "g1", name: "G", kind: "gravity", acceleration: [0, -9.8, 0] },
            { id: "g2", name: "Sway", kind: "gravity", acceleration: [1, 0, 0.5] },
          ],
        });
        expect(a.gravity).toEqual([1, -9.8, 0.5]);
        expect(a.nodal.size).toBe(0);
        expect(a.loads.map((l) => [l.kind, l.area, l.total])).toEqual([["gravity", 0, [0, 0, 0]], ["gravity", 0, [0, 0, 0]]]);
      });

      it("gravities that cancel are no gravity", () => {
        const a = applySetup(mesh, { supports: [], loads: [{ id: "a", name: "A", kind: "gravity", acceleration: [0, 1, 0] }, { id: "b", name: "B", kind: "gravity", acceleration: [0, -1, 0] }] });
        expect(a.gravity).toBeNull();
      });

      it("a support holds exactly the nodes on its faces", () => {
        const a = applySetup(mesh, { supports: [{ id: "s", name: "Wall", kind: "fixed", faces: [wall.id] }], loads: [] });
        expect(a.problems).toEqual([]);
        const [s] = a.supports;
        // the x = 0 face is 2 × 2 squares: 9 corners; and 16 edges (6 + 6 across, 4 diagonals)
        expect(s.nodes.length).toBe(order === 1 ? 9 : 9 + 16);
        expect(Array.from(s.nodes)).toEqual(Array.from(s.nodes).sort((p, q) => p - q));
        for (const n of s.nodes) expect(X[n * 3]).toBe(0);
        let onFace = 0;
        for (let n = 0; n < X.length / 3; n++) if (X[n * 3] === 0) onFace++;
        expect(s.nodes.length).toBe(onFace);
        expect(s.area).toBeCloseTo(ly * lz, 14);
        expect(s.kind).toBe("fixed");
      });

      it("a support on two faces holds the nodes of both, the shared edge's once", () => {
        const a = applySetup(mesh, { supports: [{ id: "s", name: "Corner", kind: "fixed", faces: [wall.id, top.id] }], loads: [] });
        // two 3 × 3 grids of corners sharing a row of 3
        if (order === 1) expect(a.supports[0].nodes.length).toBe(9 + 9 - 3);
        else expect(a.supports[0].nodes.length).toBe(25 + 25 - 5);
        // two faces facing different ways have no one normal
        expect(a.supports[0].normal).toBeNull();
      });

      it("a sliding support on a flat face holds along the face's outward normal", () => {
        const a = applySetup(mesh, { supports: [{ id: "s", name: "Floor", kind: "slide", faces: [front.id] }], loads: [] });
        expect(a.supports[0].kind).toBe("slide");
        expect(a.supports[0].normal).toEqual([expect.closeTo(0, 14), expect.closeTo(0, 14), expect.closeTo(1, 14)]);
      });

      it("a sliding support on faces that don't face one way is a problem, and isn't made", () => {
        const a = applySetup(mesh, { supports: [{ id: "s", name: "Bend", kind: "slide", faces: [front.id, top.id] }], loads: [] });
        expect(a.supports).toEqual([]);
        expect(a.problems).toEqual(["the support “Bend” slides, so its faces must be flat and face one way"]);
      });

      it("a load or support on no face of the mesh is a problem", () => {
        const a = applySetup(mesh, {
          supports: [{ id: "s", name: "Ghost", kind: "fixed", faces: [17] }],
          loads: [{ id: "f", name: "Nowhere", kind: "force", faces: [], force: [1, 0, 0] }, { id: "p", name: "Lost", kind: "pressure", faces: [9], pressure: 1 }],
        });
        expect(a.problems).toEqual(["the support “Ghost” is on no face of the mesh", "the load “Nowhere” is on no face of the mesh", "the load “Lost” is on no face of the mesh"]);
        expect(a.supports).toEqual([]);
        expect(a.loads).toEqual([]);
        expect(a.nodal.size).toBe(0);
      });

      it("two loads on one node add up there", () => {
        const one = applySetup(mesh, { supports: [], loads: [{ id: "a", name: "A", kind: "force", faces: [end.id], force: [1, 0, 0] }] });
        const two = applySetup(mesh, { supports: [], loads: [{ id: "a", name: "A", kind: "force", faces: [end.id], force: [1, 0, 0] }, { id: "b", name: "B", kind: "force", faces: [end.id], force: [2, 0, 0] }] });
        for (const [n, f] of one.nodal) expect(two.nodal.get(n)[0]).toBeCloseTo(3 * f[0], 14);
      });
    });
  }

  it("on a finer mesh, a support on the x = 0 face of a 3 × 2 grid holds 12 corners, or 12 + 23 nodes", () => {
    // corners (3+1)(2+1); edges 3·3 + 2·4 + 3·2 diagonals = 23
    for (const order of [1, 2]) {
      const a = applySetup(meshOf(order, [2, 3, 2]), { supports: [{ id: "s", name: "W", kind: "fixed", faces: [wall.id] }], loads: [] });
      expect(a.supports[0].nodes.length).toBe(order === 1 ? 12 : 35);
    }
  });

  it("skinOn and nodesOf: the skin triangles on faces, and their nodes once each, ascending", () => {
    const mesh = meshOf(1);
    const on = skinOn(mesh.skin, [wall.id]);
    expect(on.length).toBe(8);
    const nodes = nodesOf(mesh.skin, on);
    expect(nodes.length).toBe(9);
    expect(nodes).toBeInstanceOf(Uint32Array);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i]).toBeGreaterThan(nodes[i - 1]);
  });
});

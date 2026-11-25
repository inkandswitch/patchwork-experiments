import { TET_FACES, TET_EDGES, finishMesh, pointTriangle2, nearestFace } from "./mesh.js";
import { tetBox, partOf, GMSH_EDGES } from "../test/tetbox.js";
import { box, placed, turned } from "../test/shapes.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (X, n) => [X[n * 3], X[n * 3 + 1], X[n * 3 + 2]];
const signedVolume = (X, t) => dot(sub(at(X, t[1]), at(X, t[0])), cross(sub(at(X, t[2]), at(X, t[0])), sub(at(X, t[3]), at(X, t[0])))) / 6;

describe("TET_FACES and TET_EDGES", () => {
  // the reference tetrahedron, and its mid-edge nodes in CalculiX's order
  const X = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const [a, b] of TET_EDGES) X.push(...at(X, a).map((v, k) => (v + at(X, b)[k]) / 2));

  it("the reference tetrahedron is positive", () => {
    expect(signedVolume(X, [0, 1, 2, 3])).toBeCloseTo(1 / 6, 15);
  });

  it("each face's corners make its normal point away from the opposite corner", () => {
    TET_FACES.forEach((F) => {
      const opposite = [0, 1, 2, 3].find((c) => !F.slice(0, 3).includes(c));
      const n = cross(sub(at(X, F[1]), at(X, F[0])), sub(at(X, F[2]), at(X, F[0])));
      expect(dot(n, sub(at(X, opposite), at(X, F[0])))).toBeLessThan(0);
    });
    // four different faces: each corner left out once
    expect(TET_FACES.map((F) => [0, 1, 2, 3].find((c) => !F.slice(0, 3).includes(c))).sort()).toEqual([0, 1, 2, 3]);
  });

  it("each face's mid-edge nodes are on its edges (c0,c1), (c1,c2), (c2,c0), as TET_EDGES places them", () => {
    const edgeOf = (m) => TET_EDGES[m - 4];
    for (const F of TET_FACES) {
      const [c0, c1, c2, m01, m12, m20] = F;
      expect(edgeOf(m01).slice().sort()).toEqual([c0, c1].sort());
      expect(edgeOf(m12).slice().sort()).toEqual([c1, c2].sort());
      expect(edgeOf(m20).slice().sort()).toEqual([c2, c0].sort());
    }
  });

  it("TET_EDGES differs from gmsh's order only in the last two", () => {
    const same = (e, f) => e.slice().sort().join() === f.slice().sort().join();
    expect([0, 1, 2, 3].every((k) => same(TET_EDGES[k], GMSH_EDGES[k]))).toBe(true);
    expect(same(TET_EDGES[4], GMSH_EDGES[5]) && same(TET_EDGES[5], GMSH_EDGES[4])).toBe(true);
  });
});

/** Every check a finished mesh of a box must pass. */
function checkBox(mesh, part, [nx, ny, nz], [lx, ly, lz], order) {
  const per = order === 1 ? 4 : 10, sper = order === 1 ? 3 : 6;
  const X = mesh.nodes;
  expect(mesh.per).toBe(per);
  expect(mesh.order).toBe(order);
  expect(mesh.turned).toBe(0);
  expect(mesh.unplaced).toBe(0);

  // every tetrahedron positive; their volumes add up to the box
  let V = 0;
  for (let o = 0; o < mesh.tets.length; o += per) {
    const v = signedVolume(X, mesh.tets.subarray(o, o + 4));
    expect(v).toBeGreaterThan(0);
    V += v;
  }
  expect(Math.abs(mesh.volume - lx * ly * lz)).toBeLessThan(1e-12);
  expect(Math.abs(V - mesh.volume)).toBeLessThan(1e-15);

  // in CalculiX's order, mid-edge node 4 + k is at the middle of TET_EDGES[k]
  if (per === 10)
    for (let o = 0; o < mesh.tets.length; o += 10)
      TET_EDGES.forEach(([a, b], k) => {
        const m = at(X, mesh.tets[o + 4 + k]), A = at(X, mesh.tets[o + a]), B = at(X, mesh.tets[o + b]);
        for (let j = 0; j < 3; j++) expect(m[j]).toBeCloseTo((A[j] + B[j]) / 2, 15);
      });

  // the skin: as many triangles as the box's surface has
  const { skin } = mesh;
  expect(skin.per).toBe(sper);
  expect(skin.count).toBe(2 * 2 * (nx * ny + ny * nz + nz * nx));
  expect(skin.nodes.length).toBe(skin.count * sper);

  // closed: every edge of a skin triangle is on exactly two of them, run opposite ways
  const directed = new Map();
  for (let s = 0; s < skin.count; s++)
    for (let k = 0; k < 3; k++) {
      const key = `${skin.nodes[s * sper + k]},${skin.nodes[s * sper + ((k + 1) % 3)]}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  for (const [key, n] of directed) {
    expect(n).toBe(1);
    const [a, b] = key.split(",");
    expect(directed.get(`${b},${a}`)).toBe(1);
  }
  expect(directed.size).toBe(skin.count * 3);

  // each triangle faces away from the centre, lies on its face's plane, and the face's area is all there
  const centre = [lx / 2, ly / 2, lz / 2];
  const area = new Array(part.faces.length).fill(0);
  for (let s = 0; s < skin.count; s++) {
    const [A, B, C] = [0, 1, 2].map((k) => at(X, skin.nodes[s * sper + k]));
    const n = cross(sub(B, A), sub(C, A));
    const mid = [0, 1, 2].map((k) => (A[k] + B[k] + C[k]) / 3);
    expect(dot(n, sub(mid, centre))).toBeGreaterThan(0);
    const f = part.faces[skin.face[s]];
    expect(f).toBeDefined();
    // (the part is kept at Float32, the mesh here is exact: a few nanometres apart)
    for (const P of [A, B, C]) expect(Math.abs(dot(sub(P, f.centroid), f.normal))).toBeLessThan(1e-8);
    // the face's outward normal is the triangle's
    expect(dot(n, f.normal) / Math.hypot(...n)).toBeCloseTo(1, 12);
    area[skin.face[s]] += Math.hypot(...n) / 2;
    // the tetrahedron it came from has that face, by its local number
    const t = skin.tet[s], l = skin.local[s];
    for (let k = 0; k < sper; k++) expect(skin.nodes[s * sper + k]).toBe(mesh.tets[t * per + TET_FACES[l][k]]);
    // a six-node triangle's mid-edge nodes are its edges' middles: (0,1), (1,2), (2,0)
    if (sper === 6)
      [[0, 1], [1, 2], [2, 0]].forEach(([a, b], k) => {
        const m = at(X, skin.nodes[s * 6 + 3 + k]), P = [A, B, C][a], Q = [A, B, C][b];
        for (let j = 0; j < 3; j++) expect(m[j]).toBeCloseTo((P[j] + Q[j]) / 2, 15);
      });
  }
  part.faces.forEach((f, i) => expect(area[i] / f.area).toBeCloseTo(1, 6));
}

describe("finishMesh on a box", () => {
  const size = [0.2, 0.1, 0.05];
  const part = partOf(box(...size));

  for (const order of [1, 2]) {
    it(`order ${order}, 2×2×2: right way out, the box's volume, a closed outward skin on the part's faces`, () => {
      const mesh = finishMesh(tetBox(2, 2, 2, size, order), { method: "faces", part });
      checkBox(mesh, part, [2, 2, 2], size, order);
      expect(mesh.quality.poor).toBe(0);
      // every Kuhn tetrahedron of an a×b×c cell has volume abc/6 and the cell's diagonal for its longest edge
      const [a, b, c] = size.map((l) => l / 2);
      expect(mesh.quality.worst).toBeCloseTo((Math.SQRT2 * a * b * c) / Math.hypot(a, b, c) ** 3, 12);
    });

    it(`order ${order}, uneven 3×1×2`, () => {
      const mesh = finishMesh(tetBox(3, 1, 2, size, order), { method: "faces", part });
      checkBox(mesh, part, [3, 1, 2], size, order);
    });

    // a mesh where the ids of tetrahedron faces (tet·4 + local) run past the node ids, so
    // that a node id read as an owner id finds one: an inner face then stays in the skin
    it(`order ${order}, 5×5×5: owner ids and node ids overlap, and the skin is still only the outside`, () => {
      const parsed = tetBox(5, 5, 5, size, order);
      expect(parsed.tets.length / (order === 1 ? 4 : 10) * 4).toBeGreaterThan(parsed.nodes.length / 3);
      const mesh = finishMesh(parsed, { method: "faces", part });
      checkBox(mesh, part, [5, 5, 5], size, order);
    });

    it(`order ${order}: a tetrahedron given inside out comes back turned, the same volume`, () => {
      const parsed = tetBox(2, 2, 2, size, order);
      const per = order === 1 ? 4 : 10;
      const o = 7 * per;
      const swap = (i, j) => ([parsed.tets[o + i], parsed.tets[o + j]] = [parsed.tets[o + j], parsed.tets[o + i]]);
      // swap corners 0 and 1; in gmsh's order the edges (1,2)↔(2,0) and (3,0)↔(1,3) follow them
      swap(0, 1);
      if (per === 10) {
        swap(5, 6);
        swap(7, 9);
      }
      expect(signedVolume(parsed.nodes, parsed.tets.subarray(o, o + 4))).toBeLessThan(0);
      const mesh = finishMesh(parsed, { method: "faces", part });
      expect(mesh.turned).toBe(1);
      checkBox({ ...mesh, turned: 0 }, part, [2, 2, 2], size, order);
    });
  }

  it("a nearly flat tetrahedron is counted poor, and its score is the worst", () => {
    const nodes = Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.3, 0.3, 0.01]);
    const mesh = finishMesh({ order: 1, nodes, tets: Uint32Array.from([0, 1, 2, 3]), skin: new Uint32Array(0), skinSurface: new Int32Array(0) }, { method: "faces", part });
    expect(mesh.quality.poor).toBe(1);
    expect(mesh.quality.worst).toBeCloseTo((6 * Math.SQRT2 * (0.01 / 6)) / Math.SQRT2 ** 3, 12);
    // all four of its faces are skin, and none is on a face of the part
    expect(mesh.skin.count).toBe(4);
    expect(mesh.unplaced).toBe(4);
  });

  // The same meshes with their nodes numbered otherwise, as gmsh might: node n becomes
  // (n·k) mod N. Each of these numberings puts a node id equal to an earlier face's owner id
  // into the same pair list, which a lookup that read owner ids as corners got wrong (the
  // grid's own numbering above never does). Each was checked to fail on that lookup.
  const renumbered = (m, perm) => {
    const N = m.nodes.length / 3, nodes = new Float64Array(N * 3);
    for (let n = 0; n < N; n++) for (let k = 0; k < 3; k++) nodes[perm[n] * 3 + k] = m.nodes[n * 3 + k];
    return { ...m, nodes, tets: m.tets.map((n) => perm[n]), skin: m.skin.map((n) => perm[n]) };
  };
  for (const [cells, order, stride] of [[3, 1, 7], [3, 2, 5], [5, 1, 19], [5, 2, 5], [5, 2, -1]])
    it(`order ${order}, ${cells}×${cells}×${cells}, nodes renumbered ${stride < 0 ? "backwards" : `by a stride of ${stride}`}: the skin is still only the outside`, () => {
      const m = tetBox(cells, cells, cells, size, order);
      const N = m.nodes.length / 3;
      const perm = Array.from({ length: N }, (_, i) => (stride < 0 ? N - 1 - i : (i * stride) % N));
      expect(new Set(perm).size).toBe(N);
      checkBox(finishMesh(renumbered(m, perm), { method: "faces", part }), part, [cells, cells, cells], size, order);
    });

  it("doesn't change the tetrahedra it was given", () => {
    const parsed = tetBox(1, 1, 1, size, 2);
    const before = Array.from(parsed.tets);
    finishMesh(parsed, { method: "faces", part });
    expect(Array.from(parsed.tets)).toEqual(before);
  });

  it("'angle' puts every skin triangle on the same face as 'faces' does", () => {
    for (const order of [1, 2]) {
      const parsed = tetBox(3, 2, 2, size, order);
      const byFaces = finishMesh(parsed, { method: "faces", part });
      // gmsh's own surface numbers mean nothing to "angle": scramble them
      const byAngle = finishMesh({ ...parsed, skinSurface: parsed.skinSurface.map((s) => 100 + s) }, { method: "angle", part });
      expect(Array.from(byAngle.skin.face)).toEqual(Array.from(byFaces.skin.face));
      expect(byAngle.unplaced).toBe(0);
    }
  });

  it("'faces': a skin triangle whose surface the part doesn't have, or that gmsh didn't list, is unplaced", () => {
    const parsed = tetBox(1, 1, 1, size, 1);
    const surfaces = Int32Array.from(parsed.skinSurface);
    surfaces[0] = 7; // face 6: the box has 0…5
    const mesh = finishMesh({ ...parsed, skinSurface: surfaces, skin: parsed.skin.slice(0, parsed.skin.length - 3), }, { method: "faces", part });
    // one on a face that isn't there, one not listed at all (the list is one short, and skinSurface one long: ignored past skin)
    expect(mesh.unplaced).toBe(2);
    expect([...mesh.skin.face].filter((f) => f === -1).length).toBe(2);
  });
});

describe("pointTriangle2", () => {
  const A = [0, 0, 0], B = [2, 0, 0], C = [0, 2, 0];
  const d2 = (p) => pointTriangle2(...p, ...A, ...B, ...C);

  it("over the inside: the height squared", () => {
    expect(d2([0.5, 0.5, 3])).toBeCloseTo(9, 15);
    expect(d2([0.5, 0.5, -0.5])).toBeCloseTo(0.25, 15);
    expect(d2([0.5, 0.5, 0])).toBe(0);
  });

  it("beside each edge: the distance to the edge", () => {
    expect(d2([1, -1, 0])).toBeCloseTo(1, 15); // AB
    expect(d2([-1, 1, 1])).toBeCloseTo(2, 15); // CA
    expect(d2([2, 2, 0])).toBeCloseTo(2, 15); // BC: from (2,2) to (1,1)
  });

  it("past each corner: the distance to the corner", () => {
    expect(d2([-1, -1, 0])).toBeCloseTo(2, 15); // A
    expect(d2([3, -1, 0])).toBeCloseTo(2, 15); // B
    expect(d2([-1, 3, 1])).toBeCloseTo(3, 15); // C
  });

  it("doesn't care which way the triangle is wound", () => {
    for (const p of [[0.5, 0.5, 3], [1, -1, 0], [2, 2, 0], [-1, 3, 1], [3, -1, 0]])
      expect(pointTriangle2(...p, ...A, ...C, ...B)).toBeCloseTo(d2(p), 15);
  });
});

describe("nearestFace", () => {
  it("on a turned, moved box: a point on each face, and a little off it, is that face", () => {
    const turn = { axis: [1, 1, 0].map((v) => v / Math.SQRT2), angle: 0.6, move: [1, -2, 0.5] };
    const part = partOf(placed(box(0.3, 0.2, 0.1), turn));
    const near = nearestFace(part);
    for (const f of part.faces) {
      // points across the face: its centroid and toward its corners
      expect(near(...f.centroid)).toBe(f.id);
      const out = f.normal.map((v) => v * 0.01);
      expect(near(...f.centroid.map((v, k) => v + out[k]))).toBe(f.id);
      expect(near(...f.centroid.map((v, k) => v - out[k]))).toBe(f.id);
      // far off along the normal: still the face
      expect(near(...f.centroid.map((v, k) => v + 100 * out[k]))).toBe(f.id);
    }
    // each face's four corners, pulled a tenth of the way in toward its centre: the box
    // unturned says where they are, and the face they are on is the one facing that way, turned
    const box0 = partOf(box(0.3, 0.2, 0.1));
    for (const f of box0.faces) {
      const g = part.faces.find((g) => dot(g.normal, turned(f.normal, turn)) > 0.999);
      const [u, v] = [0, 1, 2].filter((k) => f.normal[k] === 0);
      for (const [cu, cv] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
        const corner = [...f.centroid];
        corner[u] = cu ? f.box.max[u] : f.box.min[u];
        corner[v] = cv ? f.box.max[v] : f.box.min[v];
        const p = corner.map((x, k) => x + 0.1 * (f.centroid[k] - x));
        const q = placed(Float64Array.from([...p, 0, 0, 0, 0, 0, 0]), turn).slice(0, 3);
        expect(near(...q)).toBe(g.id);
      }
    }
  });

  it("a part with no triangles has no face to give", () => {
    expect(nearestFace({ positions: new Float64Array(0), tris: new Uint32Array(0), faceOf: new Uint32Array(0) })(0, 0, 0)).toBe(-1);
  });
});

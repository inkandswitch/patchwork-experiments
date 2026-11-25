import { vonMises, summarizeStatic, summarizeModal, skinLayer, staticNotes } from "./post.js";
import { applySetup, volumeShares } from "./loads.js";
import { finishMesh } from "./mesh.js";
import { tetBox, partOf } from "../test/tetbox.js";
import { box } from "../test/shapes.js";

describe("vonMises", () => {
  it("uniaxial σ is σ, pure shear τ is √3·τ, hydrostatic is nothing", () => {
    const vm = vonMises(Float64Array.from([
      5, 0, 0, 0, 0, 0,
      0, -5, 0, 0, 0, 0,
      0, 0, 0, 2, 0, 0,
      0, 0, 0, 0, 0, -2,
      7, 7, 7, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ]));
    expect(vm[0]).toBeCloseTo(5, 14);
    expect(vm[1]).toBeCloseTo(5, 14);
    expect(vm[2]).toBeCloseTo(2 * Math.sqrt(3), 14);
    expect(vm[3]).toBeCloseTo(2 * Math.sqrt(3), 14);
    expect(vm[4]).toBe(0);
    expect(vm[5]).toBe(0);
  });

  it("a hydrostatic part added changes nothing; equal and opposite principal stresses are √3 times either", () => {
    const vm = vonMises(Float64Array.from([3 + 10, -1 + 10, 4 + 10, 1, 2, 3, 3, -1, 4, 1, 2, 3, 4, -4, 0, 0, 0, 0]));
    expect(vm[0]).toBeCloseTo(vm[1], 12);
    expect(vm[2]).toBeCloseTo(4 * Math.sqrt(3), 14);
  });
});

const size = [0.2, 0.02, 0.02];
const [L, h, w] = size;
const part = partOf(box(...size));
const faceFacing = (n) => part.faces.find((f) => n.every((v, k) => Math.abs(f.normal[k] - v) < 1e-9)).id;

describe("skinLayer", () => {
  for (const order of [1, 2])
    it(`order ${order}: the skin's triangles${order === 2 ? " cut in four" : ""}, outward, the box's area, positions only for skin nodes`, () => {
      const mesh = finishMesh(tetBox(4, 1, 2, size, order), { method: "faces", part });
      const X = mesh.nodes, N = X.length / 3;
      const vm = Float64Array.from({ length: N }, (_, n) => n * 10);
      const u = Float64Array.from({ length: N * 3 }, (_, i) => i);
      const layer = skinLayer(mesh, { scalars: { vm }, vectors: { u } });
      const cut = order === 2 ? 4 : 1;
      expect(layer.indices.length / 3).toBe(mesh.skin.count * cut);
      expect(layer.faces.length).toBe(mesh.skin.count * cut);
      // positions: the skin's nodes, each once; nothing inside the box
      const skinNodes = new Set(mesh.skin.nodes);
      expect(layer.positions.length / 3).toBe(skinNodes.size);
      const P = layer.positions;
      const onSkin = (i) => [0, 1, 2].some((k) => Math.abs(P[i * 3 + k]) < 1e-7 || Math.abs(P[i * 3 + k] - Math.fround(size[k])) < 1e-7);
      for (let i = 0; i < P.length / 3; i++) expect(onSkin(i)).toBe(true);
      // areas add up to the box's, every triangle outward
      let area = 0;
      const centre = size.map((l) => l / 2);
      for (let t = 0; t < layer.indices.length / 3; t++) {
        const [a, b, c] = [0, 1, 2].map((k) => layer.indices[t * 3 + k]);
        const A = [0, 1, 2].map((k) => P[a * 3 + k]), B = [0, 1, 2].map((k) => P[b * 3 + k]), C = [0, 1, 2].map((k) => P[c * 3 + k]);
        const e1 = B.map((v, k) => v - A[k]), e2 = C.map((v, k) => v - A[k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const m = [0, 1, 2].map((k) => (A[k] + B[k] + C[k]) / 3 - centre[k]);
        expect(n[0] * m[0] + n[1] * m[1] + n[2] * m[2]).toBeGreaterThan(0);
        area += Math.hypot(...n) / 2;
        // each drawn triangle carries its skin triangle's face, and lies on it
        expect(layer.faces[t]).toBe(mesh.skin.face[Math.floor(t / cut)]);
        const f = part.faces[layer.faces[t]];
        expect((n[0] * f.normal[0] + n[1] * f.normal[1] + n[2] * f.normal[2]) / Math.hypot(...n)).toBeCloseTo(1, 5);
      }
      expect(area / (2 * (L * h + h * w + w * L))).toBeCloseTo(1, 5);
      // fields: one value a drawn point, the node's
      expect(Object.keys(layer.fields).sort()).toEqual(["ux", "uy", "uz", "vm"]);
      const order_ = [];
      for (const n of mesh.skin.nodes) if (!order_.includes(n)) order_.push(n);
      order_.forEach((n, i) => {
        expect(layer.fields.vm[i]).toBe(Math.fround(n * 10));
        expect([layer.fields.ux[i], layer.fields.uy[i], layer.fields.uz[i]]).toEqual([n * 3, n * 3 + 1, n * 3 + 2].map(Math.fround));
        for (let k = 0; k < 3; k++) expect(P[i * 3 + k]).toBe(Math.fround(X[n * 3 + k]));
      });
      expect(layer.positions).toBeInstanceOf(Float32Array);
      expect(layer.fields.vm).toBeInstanceOf(Float32Array);
    });

  it("a skin triangle on no face of the part draws as 0xffffffff", () => {
    const mesh = finishMesh(tetBox(1, 1, 1, size, 1), { method: "faces", part });
    mesh.skin.face[0] = -1;
    expect(skinLayer(mesh).faces[0]).toBe(0xffffffff);
    expect(skinLayer(mesh).fields).toEqual({});
  });
});

describe("summarizeStatic", () => {
  // a bar held at x = 0, pulled along +x at x = L: u_x = ε·x, σ_xx = σ everywhere
  const F = 1000, eps = 1e-4, sigma = 2.5e6;
  const setupOf = (gravity) => ({
    supports: [{ id: "wall", name: "Wall", kind: "fixed", faces: [faceFacing([-1, 0, 0])] }],
    loads: [
      { id: "pull", name: "Pull", kind: "force", faces: [faceFacing([1, 0, 0])], force: [F, 0, 0] },
      ...(gravity ? [{ id: "g", name: "Weight", kind: "gravity", acceleration: gravity }] : []),
    ],
  });
  const material = { density: 2700, yield: 2.75e8 };
  const fields = (mesh) => {
    const N = mesh.nodes.length / 3;
    const U = new Float64Array(N * 3), S = new Float64Array(N * 6);
    for (let n = 0; n < N; n++) {
      U[n * 3] = eps * mesh.nodes[n * 3];
      S[n * 6] = sigma;
    }
    return { U, S };
  };

  for (const order of [1, 2])
    describe(`order ${order}`, () => {
      const mesh = finishMesh(tetBox(4, 1, 1, size, order), { method: "faces", part });
      const applied = applySetup(mesh, setupOf(null));
      const { U, S } = fields(mesh);
      const sets = [{ id: "wall", set: "SUP1" }];
      const dat = { forces: [{ set: "SUP1", force: [-F, 0, 0] }], energy: 0.5 * F * eps * L, frequencies: [] };
      const sum = summarizeStatic({ mesh, U, S, applied, sets, dat, material });

      it("how far it moved, and where", () => {
        expect(sum.kind).toBe("static");
        expect(sum.displacement.max).toBeCloseTo(eps * L, 15);
        expect(sum.displacement.at[0]).toBeCloseTo(L, 15);
        expect(sum.displacement.vector[0]).toBeCloseTo(eps * L, 15);
      });

      it("how hard it is worked, and the safety factor", () => {
        expect(sum.stress.max).toBeCloseTo(sigma, 6);
        expect(sum.stress.p99).toBeCloseTo(sigma, 6);
        expect(sum.safety).toBeCloseTo(2.75e8 / sigma, 10);
      });

      it("the supports' forces answer the loads", () => {
        expect(sum.reactions).toEqual([{ id: "wall", name: "Wall", kind: "fixed", force: [-F, 0, 0] }]);
        expect(sum.pushed[0]).toBeCloseTo(F, 9);
        expect(sum.balance).toBeLessThan(1e-12);
      });

      it("the work the loads did is ½·F·εL, and agrees with the strain energy", () => {
        expect(sum.work).toBeCloseTo(0.5 * F * eps * L, 12);
        expect(sum.energy).toBe(0.5 * F * eps * L);
        expect(sum.adrift).toBeLessThan(1e-9);
      });

      it("mass is density times volume; no gravity, no weight", () => {
        expect(sum.volume).toBeCloseTo(L * h * w, 15);
        expect(sum.mass).toBeCloseTo(2700 * L * h * w, 12);
        expect(sum.weight).toBeNull();
        expect(sum.loads).toEqual([{ id: "pull", name: "Pull", kind: "force", area: applied.loads[0].area, total: applied.loads[0].total }]);
      });

      it("with gravity: a support's reaction includes the weight resting on its own nodes", () => {
        const g = [0, -9.80665, 0];
        const ap = applySetup(mesh, setupOf(g));
        // what CalculiX prints for the support: the force inside the part at its nodes, which
        // is minus every load on the nodes it doesn't hold
        const held = new Set(ap.supports[0].nodes);
        const share = volumeShares(mesh);
        const inside = [0, 0, 0];
        for (let n = 0; n < mesh.nodes.length / 3; n++) {
          if (held.has(n)) continue;
          const f = ap.nodal.get(n) ?? [0, 0, 0];
          for (let k = 0; k < 3; k++) inside[k] -= f[k] + material.density * share[n] * g[k];
        }
        const s = summarizeStatic({ mesh, U, S, applied: ap, sets, dat: { forces: [{ set: "SUP1", force: inside }], energy: null, frequencies: [] }, material });
        const mass = material.density * L * h * w;
        expect(s.weight[1]).toBeCloseTo(g[1] * mass, 9);
        expect(s.pushed[0]).toBeCloseTo(F, 9);
        expect(s.pushed[1]).toBeCloseTo(g[1] * mass, 9);
        // the reaction is everything the support carries: the pull and the whole weight
        for (let k = 0; k < 3; k++) expect(s.reactions[0].force[k] + s.pushed[k]).toBeCloseTo(0, 9);
        expect(s.balance).toBeLessThan(1e-9);
        expect(s.adrift).toBeNull();
        // the work counts the weight's share at every node too: u_x = εx, the weight is along y
        expect(s.work).toBeCloseTo(0.5 * F * eps * L, 12);
      });
    });

  it("a node on two supports: the totals can't be added, so no balance is given", () => {
    const mesh = finishMesh(tetBox(4, 1, 1, size, 1), { method: "faces", part });
    const applied = applySetup(mesh, {
      supports: [{ id: "a", name: "A", kind: "fixed", faces: [faceFacing([-1, 0, 0])] }, { id: "b", name: "B", kind: "fixed", faces: [faceFacing([0, -1, 0])] }],
      loads: [{ id: "f", name: "F", kind: "force", faces: [faceFacing([1, 0, 0])], force: [F, 0, 0] }],
    });
    const { U, S } = fields(mesh);
    const s = summarizeStatic({ mesh, U, S, applied, sets: [{ id: "a", set: "SUP1" }, { id: "b", set: "SUP2" }], dat: { forces: [{ set: "SUP1", force: [-F, 0, 0] }, { set: "SUP2", force: [0, 0, 0] }], energy: null, frequencies: [] }, material });
    expect(s.balance).toBeNull();
    // each support's own reaction is still given
    expect(s.reactions.every((r) => r.force && r.force.every(Number.isFinite))).toBe(true);
  });

  it("a support whose total wasn't printed: its reaction unknown, and no balance", () => {
    const mesh = finishMesh(tetBox(2, 1, 1, size, 1), { method: "faces", part });
    const applied = applySetup(mesh, setupOf(null));
    const { U, S } = fields(mesh);
    const s = summarizeStatic({ mesh, U, S, applied, sets: [{ id: "wall", set: "SUP1" }], dat: { forces: [], energy: null, frequencies: [] }, material });
    expect(s.reactions[0].force).toBeNull();
    expect(s.balance).toBeNull();
  });

  it("forces off by 5%: balance 0.05", () => {
    const mesh = finishMesh(tetBox(2, 1, 1, size, 1), { method: "faces", part });
    const applied = applySetup(mesh, setupOf(null));
    const { U, S } = fields(mesh);
    const s = summarizeStatic({ mesh, U, S, applied, sets: [{ id: "wall", set: "SUP1" }], dat: { forces: [{ set: "SUP1", force: [-0.95 * F, 0, 0] }], energy: null, frequencies: [] }, material });
    expect(s.balance).toBeCloseTo(0.05, 9);
  });

  it("no yield strength: no safety factor", () => {
    const mesh = finishMesh(tetBox(1, 1, 1, size, 1), { method: "faces", part });
    const applied = applySetup(mesh, setupOf(null));
    const { U, S } = fields(mesh);
    const s = summarizeStatic({ mesh, U, S, applied, sets: [], dat: { forces: [], energy: null, frequencies: [] }, material: { density: 1, yield: null } });
    expect(s.safety).toBeNull();
  });

  it("the peak stress at a held node is said to be at a support; elsewhere it isn't", () => {
    const mesh = finishMesh(tetBox(2, 1, 1, size, 1), { method: "faces", part });
    const applied = applySetup(mesh, setupOf(null));
    const N = mesh.nodes.length / 3;
    const U = new Float64Array(N * 3);
    const peakAt = (pick) => {
      const S = new Float64Array(N * 6);
      const n = [...Array(N).keys()].find(pick);
      S[n * 6] = 1e6;
      return summarizeStatic({ mesh, U, S, applied, sets: [], dat: { forces: [], energy: null, frequencies: [] }, material }).stress;
    };
    const atWall = peakAt((n) => mesh.nodes[n * 3] === 0);
    expect(atWall.atSupport).toBe(true);
    expect(atWall.at[0]).toBe(0);
    const atEnd = peakAt((n) => mesh.nodes[n * 3] === L);
    expect(atEnd.atSupport).toBe(false);
    expect(atEnd.max).toBe(1e6);
  });
});

describe("summarizeModal", () => {
  it("each mode's frequency from the .dat, null where it gave none; mass and volume", () => {
    const mesh = { volume: 2e-3 };
    const s = summarizeModal({ mesh, dat: { frequencies: [{ mode: 1, hz: 10 }, { mode: 3, hz: 30 }] }, material: { density: 1000 }, modes: [{ mode: 1 }, { mode: 2 }, { mode: 3 }] });
    expect(s).toEqual({ kind: "modal", modes: [{ mode: 1, hz: 10 }, { mode: 2, hz: null }, { mode: 3, hz: 30 }], mass: 2, volume: 2e-3 });
  });
});

describe("staticNotes", () => {
  const clean = { displacement: { max: 0.001 }, stress: { max: 1e8, atSupport: false }, balance: 0.001 };
  const notesOf = (change, o = {}) => staticNotes({ ...clean, ...change }, { diagonal: 1, yield: 2e8, poor: 0, ...o });

  it("none on a clean result", () => {
    expect(notesOf({})).toEqual([]);
    expect(notesOf({ balance: null })).toEqual([]);
  });

  it("moved ten times its size or more: something isn't held, and nothing else about stress", () => {
    const n = notesOf({ displacement: { max: 10 }, stress: { max: 1e9, atSupport: false } });
    expect(n).toEqual(["It moved 10 times its own size: something isn't held. Supports that only slide must between them stop it moving and turning every way."]);
    expect(notesOf({ displacement: { max: 5000 } })[0]).toMatch(/^It moved thousands of times/);
    expect(notesOf({ displacement: { max: 9.99 } })[0]).toMatch(/^It moves 999% of its own size/);
  });

  it("moved past a twentieth of its size: a guide only", () => {
    expect(notesOf({ displacement: { max: 0.06 } })).toEqual(["It moves 6% of its own size. This analysis assumes small movements, so past a few percent read it as a guide."]);
    expect(notesOf({ displacement: { max: 0.05 } })).toEqual([]);
  });

  it("past yield", () => {
    expect(notesOf({ stress: { max: 2.1e8, atSupport: false } })).toEqual(["The highest stress is past the material's yield strength. Past yield a material stops springing back, and this analysis, which assumes it always does, stops describing it."]);
    expect(notesOf({ stress: { max: 2.1e8, atSupport: false } }, { yield: null })).toEqual([]);
  });

  it("the peak at a support", () => {
    expect(notesOf({ stress: { max: 1e8, atSupport: true } })).toEqual(["The highest stress is where a support holds the part. A fixed face stops its edge from thinning as real fixings would let it, so the stress right there climbs as the mesh gets finer: read the stress a little way off."]);
  });

  it("the forces off balance by more than a hundredth", () => {
    expect(notesOf({ balance: 0.0123 })).toEqual(["The supports' forces are 1.2% off answering the loads; they should cancel."]);
    expect(notesOf({ balance: 0.01 })).toEqual([]);
  });

  it("badly shaped elements, one or many", () => {
    expect(notesOf({}, { poor: 1 })).toEqual(["1 element is badly shaped (nearly flat), which can spoil the stress near it. A finer mesh usually has none."]);
    expect(notesOf({}, { poor: 3 })).toEqual(["3 elements are badly shaped (nearly flat), which can spoil the stress near them. A finer mesh usually has none."]);
  });

  it("several at once, in that order", () => {
    const n = notesOf({ displacement: { max: 0.2 }, stress: { max: 3e8, atSupport: true }, balance: 0.5 }, { poor: 2 });
    expect(n.map((s) => s.slice(0, 12))).toEqual(["It moves 20%", "The highest ", "The highest ", "The supports", "2 elements a"]);
  });
});

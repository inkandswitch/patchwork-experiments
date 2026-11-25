import { partGeometry, resultGeometry, fieldChoices, modesOf, AUTO_DEFORM } from "./result.js";
import { turbo, srgbToLinear, bake, stops, hex } from "./colors.js";
import { skinLayer } from "../solver/post.js";
import { finishMesh } from "../solver/mesh.js";
import { encodeLayer, decodeLayer } from "../protocol.js";
import { tetBox, partOf } from "../test/tetbox.js";
import { box } from "../test/shapes.js";

const size = [0.2, 0.02, 0.02];
const [L] = size;
const part = partOf(box(...size));
const diagonal = part.diagonal;
const mesh = finishMesh(tetBox(4, 1, 1, size, 2), { method: "faces", part });
const N = mesh.nodes.length / 3;
const X = mesh.nodes;

/** A static result: stress rising along the bar to 2·10⁵ Pa, the far end moving most (bending down and stretching). */
function staticLayer() {
  const vm = Float64Array.from({ length: N }, (_, n) => 1e6 * X[n * 3]);
  const u = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) {
    const x = X[n * 3];
    u[n * 3] = 1e-6 * x;
    u[n * 3 + 1] = -1e-3 * x * x;
  }
  // through the doc's form and back, as the tool and the scene read it
  return decodeLayer(encodeLayer({ name: "skin", ...skinLayer(mesh, { scalars: { vm }, vectors: { u } }) }));
}
/** A modal result: two mode shapes, the second twice the first's size and along z. */
function modalLayer() {
  const m1 = new Float64Array(N * 3), m2 = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) {
    m1[n * 3 + 1] = X[n * 3] / L;
    m2[n * 3 + 2] = (2 * X[n * 3]) / L;
  }
  return decodeLayer(encodeLayer({ name: "skin", ...skinLayer(mesh, { vectors: { m2, m1 } }) }));
}

/** How far each drawn vertex was moved: its place drawn moved, less its place drawn not at all (same vertices, same order). */
function movedBy(layer, opts) {
  const moved = resultGeometry(layer, { ...opts, diagonal }), still = resultGeometry(layer, { ...opts, deform: "none", diagonal });
  expect(moved.positions.length).toBe(still.positions.length);
  let largest = 0;
  for (let i = 0; i < moved.positions.length; i += 3) largest = Math.max(largest, Math.hypot(moved.positions[i] - still.positions[i], moved.positions[i + 1] - still.positions[i + 1], moved.positions[i + 2] - still.positions[i + 2]));
  return { largest, scale: moved.scale };
}

describe("partGeometry", () => {
  const g = partGeometry(part);

  it("a box: 24 vertices, none shared between two faces, 12 triangles", () => {
    expect(g.positions.length / 3).toBe(24);
    expect(g.indices.length / 3).toBe(12);
    expect(Array.from(g.faces)).toEqual(Array.from(part.faceOf));
    const faceOfVertex = new Map();
    for (let t = 0; t < 12; t++)
      for (let k = 0; k < 3; k++) {
        const v = g.indices[t * 3 + k];
        if (faceOfVertex.has(v)) expect(faceOfVertex.get(v)).toBe(g.faces[t]);
        faceOfVertex.set(v, g.faces[t]);
      }
  });

  it("each vertex's normal is its face's", () => {
    for (let t = 0; t < 12; t++) {
      const n = part.faces[g.faces[t]].normal;
      for (let k = 0; k < 3; k++) {
        const v = g.indices[t * 3 + k];
        for (let j = 0; j < 3; j++) expect(g.normals[v * 3 + j]).toBeCloseTo(n[j], 7);
      }
    }
  });

  it("the triangles are the part's, in its order and winding", () => {
    for (let t = 0; t < 12; t++)
      for (let k = 0; k < 3; k++) {
        const v = g.indices[t * 3 + k], p = part.tris[t * 3 + k];
        for (let j = 0; j < 3; j++) expect(g.positions[v * 3 + j]).toBe(Math.fround(part.positions[p * 3 + j]));
      }
  });
});

describe("fieldChoices and modesOf", () => {
  it("a static layer: stress, displacement, plain", () => {
    expect(fieldChoices(staticLayer()).map((c) => c.id)).toEqual(["vm", "u", "plain"]);
    expect(modesOf(staticLayer())).toEqual([]);
  });

  it("a modal layer: its modes in order, and plain", () => {
    expect(fieldChoices(modalLayer()).map((c) => c.id)).toEqual(["m1", "m2", "plain"]);
    expect(modesOf(modalLayer())).toEqual([1, 2]);
    expect(modesOf({ fields: { m10x: 1, m2x: 1, m3y: 1 } })).toEqual([2, 10]);
  });
});

describe("resultGeometry: how far it is drawn moved", () => {
  const layer = staticLayer();
  // the far end moves most: (10⁻⁶·L, −10⁻³·L²)
  const realFar = Math.hypot(1e-6 * L, 1e-3 * L * L);

  it("'auto': the largest movement drawn as AUTO_DEFORM of the part's size", () => {
    const { largest, scale } = movedBy(layer, { deform: "auto" });
    expect(largest / (AUTO_DEFORM * diagonal)).toBeCloseTo(1, 5);
    expect(scale * realFar).toBeCloseTo(AUTO_DEFORM * diagonal, 6);
  });

  it("'true': as it really moved", () => {
    const { largest, scale } = movedBy(layer, { deform: "true" });
    expect(scale).toBe(1);
    expect(largest / realFar).toBeCloseTo(1, 4);
  });

  it("'none': not at all", () => {
    const g = resultGeometry(layer, { deform: "none", diagonal });
    expect(g.scale).toBe(0);
    // every drawn vertex is where its node is
    for (let i = 0; i < g.positions.length; i += 3) {
      const p = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
      let found = false;
      for (let j = 0; j < layer.positions.length && !found; j += 3) found = p.every((v, k) => v === layer.positions[j + k]);
      expect(found).toBe(true);
    }
  });

  it("a number: that many times its real movement", () => {
    const { largest, scale } = movedBy(layer, { deform: 50 });
    expect(scale).toBe(50);
    expect(largest / (50 * realFar)).toBeCloseTo(1, 4);
  });

  it("the default is automatic", () => {
    expect(resultGeometry(layer, { diagonal }).scale).toBe(resultGeometry(layer, { deform: "auto", diagonal }).scale);
  });

  it("a mode's shape is always drawn at the automatic scale, unless not at all", () => {
    const m = modalLayer();
    for (const deform of ["auto", "true", 50]) {
      for (const field of ["m1", "m2"]) {
        const { largest } = movedBy(m, { field, deform });
        expect(largest / (AUTO_DEFORM * diagonal)).toBeCloseTo(1, 5);
      }
    }
    expect(resultGeometry(m, { field: "m1", deform: "none", diagonal }).scale).toBe(0);
  });

  it("a mode moves by its own shape: mode 1 along y, mode 2 along z", () => {
    const m = modalLayer();
    for (const [field, axis] of [["m1", 1], ["m2", 2]]) {
      const moved = resultGeometry(m, { field, diagonal }), still = resultGeometry(m, { field, deform: "none", diagonal });
      for (let i = 0; i < moved.positions.length; i += 3)
        for (let k = 0; k < 3; k++) if (k !== axis) expect(moved.positions[i + k]).toBe(still.positions[i + k]);
    }
  });
});

describe("resultGeometry: colours and legend", () => {
  const layer = staticLayer();

  it("vm: linear RGB of turbo over [0, the largest stress]", () => {
    const g = resultGeometry(layer, { field: "vm", deform: "none", diagonal });
    expect(g.field).toBe("vm");
    const max = Math.max(...layer.fields.vm);
    expect(g.range).toEqual([0, max]);
    expect(g.colors.length).toBe(g.positions.length);
    for (let i = 0; i < g.positions.length / 3; i++) {
      // the field here is 10⁶·x, so a drawn vertex's value is read from where it is
      const value = Math.fround(1e6 * g.positions[i * 3]);
      const want = turbo(value / max).map(srgbToLinear);
      for (let k = 0; k < 3; k++) expect(g.colors[i * 3 + k]).toBeCloseTo(want[k], 5);
    }
  });

  it("the legend in the unit pretty picks, its top the range's", () => {
    const g = resultGeometry(layer, { field: "vm", diagonal });
    expect(g.legend.title).toBe("Von Mises stress");
    expect(g.legend.unit).toBe("kPa");
    expect(g.legend.min).toBe(0);
    expect(g.legend.max).toBeCloseTo(200, 3);
    expect(g.legend.stops).toEqual(stops(9));
    const u = resultGeometry(layer, { field: "u", diagonal });
    expect(u.legend.title).toBe("Displacement");
    expect(u.legend.unit).toBe("µm");
    expect(u.legend.max).toBeCloseTo(Math.hypot(1e-6 * L, 1e-3 * L * L) * 1e6, 3);
  });

  it("'top' sets the colours' top end", () => {
    const max = Math.max(...layer.fields.vm);
    const g = resultGeometry(layer, { field: "vm", deform: "none", diagonal, top: 2 * max });
    expect(g.range).toEqual([0, 2 * max]);
    expect(g.legend.max).toBeCloseTo(400, 3);
    // the hottest vertex is half way up the map
    let hottest = 0;
    for (let i = 0; i < g.positions.length / 3; i++) if (g.positions[i * 3] > g.positions[hottest * 3]) hottest = i;
    const want = turbo(0.5).map(srgbToLinear);
    for (let k = 0; k < 3; k++) expect(g.colors[hottest * 3 + k]).toBeCloseTo(want[k], 5);
    // a top that isn't a positive number is ignored
    expect(resultGeometry(layer, { field: "vm", diagonal, top: 0 }).range).toEqual([0, max]);
    expect(resultGeometry(layer, { field: "vm", diagonal, top: NaN }).range).toEqual([0, max]);
  });

  it("'plain': no colours and no legend; a field the layer hasn't: its first", () => {
    const p = resultGeometry(layer, { field: "plain", diagonal });
    expect(p.colors).toBeNull();
    expect(p.legend).toBeNull();
    expect(p.range).toBeNull();
    expect(resultGeometry(layer, { field: "m3", diagonal }).field).toBe("vm");
    expect(resultGeometry(layer, { diagonal }).field).toBe("vm");
  });

  it("a mode: coloured by how much each part moves, as a fraction of the most", () => {
    const m = modalLayer();
    const g = resultGeometry(m, { field: "m2", diagonal });
    expect(g.legend).toEqual({ title: "Mode 2: how much each part moves", unit: "of the most", min: 0, max: 1, stops: stops(9) });
    expect(g.range[1]).toBeCloseTo(2, 6);
  });

  it("faces come through split vertices; normals are unit", () => {
    const g = resultGeometry(layer, { diagonal });
    expect(Array.from(g.faces)).toEqual(Array.from(layer.faces));
    for (let i = 0; i < g.normals.length; i += 3) expect(Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2])).toBeCloseTo(1, 5);
    // no vertex shared by triangles on two faces
    const faceOf = new Map();
    for (let t = 0; t < g.indices.length / 3; t++)
      for (let k = 0; k < 3; k++) {
        const v = g.indices[t * 3 + k];
        if (faceOf.has(v)) expect(faceOf.get(v)).toBe(g.faces[t]);
        faceOf.set(v, g.faces[t]);
      }
  });

  it("a layer with nothing moving and nothing stressed draws, uncoloured at the bottom of the map", () => {
    const flat = decodeLayer(encodeLayer({ name: "z", ...skinLayer(mesh, { scalars: { vm: new Float64Array(N) }, vectors: { u: new Float64Array(N * 3) } }) }));
    const g = resultGeometry(flat, { diagonal });
    expect(g.scale).toBe(0);
    expect(g.range).toEqual([0, 1]);
    const want = turbo(0).map(srgbToLinear);
    for (let k = 0; k < 3; k++) expect(g.colors[k]).toBeCloseTo(want[k], 6);
  });
});

describe("colors", () => {
  it("turbo stays in 0…1, and runs blue to red", () => {
    for (let i = 0; i <= 100; i++) for (const c of turbo(i / 100)) expect(c >= 0 && c <= 1).toBe(true);
    const [r0, , b0] = turbo(0.1), [r1, , b1] = turbo(0.9);
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(b1);
    expect(turbo(-1)).toEqual(turbo(0));
    expect(turbo(2)).toEqual(turbo(1));
    expect(turbo(NaN)).toEqual(turbo(0));
  });

  it("bake: three linear channels a value; an empty range doesn't divide by zero", () => {
    const c = bake([0, 5, 10], [0, 10]);
    expect(c.length).toBe(9);
    const mid = turbo(0.5).map(srgbToLinear);
    for (let k = 0; k < 3; k++) expect(c[3 + k]).toBeCloseTo(mid[k], 6);
    expect(Array.from(bake([3], [3, 3])).every(Number.isFinite)).toBe(true);
  });

  it("hex and stops", () => {
    expect(hex([1, 0, 0.5])).toBe("#ff0080");
    expect(stops(3)).toEqual([hex(turbo(0)), hex(turbo(0.5)), hex(turbo(1))]);
    expect(stops(1)).toEqual([hex(turbo(0.5))]);
  });
});

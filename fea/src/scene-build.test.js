import { buildStudyGLB } from "./scene-build.js";
import { parseGLB } from "./glb.js";
import { readPart } from "./part/faces.js";
import { decodePart, encodePart } from "./part/kept.js";
import { finishMesh } from "./solver/mesh.js";
import { skinLayer } from "./solver/post.js";
import { encodeLayer, decodeLayer } from "./protocol.js";
import { normalizeSetup } from "./setup.js";
import { tetBox } from "./test/tetbox.js";
import { box } from "./test/shapes.js";

const size = [0.2, 0.02, 0.02];
const part = decodePart(encodePart(readPart(box(...size)), { url: "automerge:p", title: "bar", readAt: 0 }));
const mesh = finishMesh(tetBox(4, 1, 1, size, 2), { method: "faces", part });
const N = mesh.nodes.length / 3;
const faceFacing = (n) => part.faces.find((f) => n.every((v, k) => Math.abs(f.normal[k] - v) < 1e-9)).id;
const setup = normalizeSetup({
  supports: { a: { name: "Wall", kind: "fixed", faces: [faceFacing([-1, 0, 0])] } },
  loads: { b: { name: "Tip", kind: "force", faces: [faceFacing([1, 0, 0])], magnitude: { value: 1, unit: "kN" }, direction: [0, -1, 0] } },
});
const staticLayer = () => {
  const vm = Float64Array.from({ length: N }, (_, n) => 1e8 * (1 - mesh.nodes[n * 3] / size[0]));
  const u = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) u[n * 3 + 1] = -1e-2 * mesh.nodes[n * 3] ** 2;
  return decodeLayer(encodeLayer({ name: "skin", ...skinLayer(mesh, { scalars: { vm }, vectors: { u } }) }));
};
const modalLayer = () => {
  const m1 = new Float64Array(N * 3), m2 = new Float64Array(N * 3);
  for (let n = 0; n < N; n++) [m1[n * 3 + 1], m2[n * 3 + 2]] = [mesh.nodes[n * 3], mesh.nodes[n * 3]];
  return decodeLayer(encodeLayer({ name: "skin", ...skinLayer(mesh, { vectors: { m1, m2 } }) }));
};

/** The GLB read back: its meshes by name, each with its node's layer. */
function read(out) {
  expect(out.kind).toBe("glb");
  const { json } = parseGLB(out.glb);
  const byName = {};
  for (const node of json.nodes ?? []) if (node.mesh != null) byName[node.name] = { mesh: json.meshes[node.mesh], layer: node.extras?.layer };
  return { json, byName };
}

describe("buildStudyGLB", () => {
  it("with results: a coloured Result mesh with its legend, and the marks on their layers", () => {
    const out = buildStudyGLB({ layer: staticLayer(), part, setup, params: {} });
    const { json, byName } = read(out);
    expect(Object.keys(byName).sort()).toEqual(["Loads", "Result", "Supports"]);
    const result = byName.Result;
    expect(result.layer).toBe("part");
    expect(result.mesh.primitives[0].attributes.COLOR_0).toBeDefined();
    expect(result.mesh.primitives[0].attributes.NORMAL).toBeDefined();
    expect(result.mesh.extras.legend.title).toBe("Von Mises stress");
    expect(result.mesh.extras.legend.unit).toBe("MPa");
    expect(result.mesh.extras.legend.max).toBeCloseTo(100, 3);
    expect(byName.Supports.layer).toBe("supports");
    expect(byName.Loads.layer).toBe("loads");
    expect(byName.Supports.mesh.primitives[0].mode).toBe(1);
    expect(byName.Loads.mesh.primitives[0].mode).toBe(1);
    expect(json.scenes[0].extras.layers.map((l) => l.id)).toEqual(["part", "supports", "loads"]);
    expect(out.meta.notes).toMatch(/^drawn moved .+× what it really moves$/);
  });

  it("drawn as it really moves: no note about the scale", () => {
    expect(buildStudyGLB({ layer: staticLayer(), part, setup, params: { deform: "true" } }).meta.notes).toBe("");
    expect(buildStudyGLB({ layer: staticLayer(), part, setup, params: { deform: "none" } }).meta.notes).toBe("");
  });

  it("coloured by displacement when asked; plain has no colours and no legend", () => {
    const u = read(buildStudyGLB({ layer: staticLayer(), part, setup, params: { show: "u" } }));
    expect(u.byName.Result.mesh.extras.legend.title).toBe("Displacement");
    const plain = read(buildStudyGLB({ layer: staticLayer(), part, setup, params: { show: "plain" } }));
    expect(plain.byName.Result.mesh.primitives[0].attributes.COLOR_0).toBeUndefined();
    expect(plain.byName.Result.mesh.extras ?? {}).toEqual({});
  });

  it("a modal run shows the mode asked for, or the first with a note when it has no such mode", () => {
    const two = read(buildStudyGLB({ layer: modalLayer(), part, setup, params: { mode: 2 } }));
    expect(two.byName.Result.mesh.extras.legend.title).toBe("Mode 2: how much each part moves");
    const out = buildStudyGLB({ layer: modalLayer(), part, setup, params: { mode: 7 } });
    expect(read(out).byName.Result.mesh.extras.legend.title).toBe("Mode 1: how much each part moves");
    expect(out.meta.notes).toMatch(/the run has no mode 7: mode 1 is shown/);
  });

  it("without results: the plain Part, and the marks", () => {
    const { byName } = read(buildStudyGLB({ part, setup, params: {} }));
    expect(Object.keys(byName).sort()).toEqual(["Loads", "Part", "Supports"]);
    expect(byName.Part.layer).toBe("part");
    expect(byName.Part.mesh.primitives[0].attributes.COLOR_0).toBeUndefined();
  });

  it("marks: false leaves the line meshes out; no setup has none", () => {
    expect(Object.keys(read(buildStudyGLB({ layer: staticLayer(), part, setup, params: { marks: false } })).byName)).toEqual(["Result"]);
    expect(Object.keys(read(buildStudyGLB({ part, params: {} })).byName)).toEqual(["Part"]);
  });

  it("nothing at all: a valid, empty GLB, and the notes it was given", () => {
    const out = buildStudyGLB({ notes: ["link a part"] });
    const { json } = parseGLB(out.glb);
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes ?? []).toEqual([]);
    expect(out.meta.bounds).toBeNull();
    expect(out.meta.notes).toBe("link a part");
    expect(buildStudyGLB({}).meta.notes).toBe("");
  });

  it("a layer without its part draws nothing", () => {
    expect(buildStudyGLB({ layer: staticLayer() }).meta.bounds).toBeNull();
  });

  it("the bounds cover the part", () => {
    for (const out of [buildStudyGLB({ part, setup }), buildStudyGLB({ layer: staticLayer(), part, setup, params: { deform: "none" } })]) {
      const { min, max } = out.meta.bounds;
      for (let k = 0; k < 3; k++) {
        expect(min[k]).toBeLessThanOrEqual(part.box.min[k]);
        expect(max[k]).toBeGreaterThanOrEqual(part.box.max[k]);
      }
    }
  });
});

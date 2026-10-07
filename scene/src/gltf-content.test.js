import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeGLB, computeNormals, parseGLB, MODE } from "./glb.js";
import { applyMaterialRules, authoredMaterials, collapseInstances, dequantizePositions, loadGLTF, localParts, prepareGLB, prepareMaterials, sharedLoader } from "./gltf-content.js";
import { Box3, Euler, Matrix4, Group } from "three";
import { sanitizeRules } from "./material-rules.js";
import { nearestScreenVertex } from "./viewport.js";

// Two unmodified files from solander38.com (CC BY 4.0, Rising Tide Research
// Foundation; see test/fixtures/README.md): EXT_meshopt_compression +
// KHR_mesh_quantization, as the site ships them.
const fixture = (name) => new Uint8Array(readFileSync(join(process.cwd(), "src/test/fixtures", name)));
const FREEZER = fixture("solander-freezer.glb"); // one mesh, an unnamed Rhino display colour (metal 1, rough 1)
const CELL = fixture("solander-battery-cell.glb"); // one mesh used by 8 nodes

const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const SRGB = "srgb";

/** A GLB from a glTF JSON and its BIN chunk. */
function packGLB(json, bin) {
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jl = (enc.length + 3) & ~3;
  const bl = (bin.length + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jl + 8 + bl);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl);
  out.set(enc, 20);
  dv.setUint32(20 + jl, bl, true);
  dv.setUint32(24 + jl, 0x004e4942, true);
  out.set(bin, 28 + jl);
  return out;
}

describe("gltf content", () => {
  it("shares one loader with a meshopt decoder", () => {
    expect(sharedLoader()).toBe(sharedLoader());
    expect(sharedLoader().meshoptDecoder).toBeTruthy();
  });

  it("decodes a meshopt + quantized site GLB and dequantizes POSITION to Float32 metres", async () => {
    const gltf = await loadGLTF(FREEZER);
    const meshes = [];
    gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
    expect(meshes.length).toBe(1);
    const before = meshes[0].geometry.getAttribute("position");
    expect(before.normalized || !(before.array instanceof Float32Array)).toBe(true);
    const wasBox = meshes[0].geometry.boundingBox?.clone();
    expect(dequantizePositions(gltf.scene)).toBe(1);
    const after = meshes[0].geometry.getAttribute("position");
    expect(after.array).toBeInstanceOf(Float32Array);
    expect(after.normalized).toBe(false);
    // same geometry: bounds unchanged by the conversion
    if (wasBox) for (const k of ["min", "max"]) wasBox[k].toArray().forEach((v, i) => expect(meshes[0].geometry.boundingBox[k].getComponent(i)).toBeCloseTo(v, 4));
    // and now the snap routine can read it: the nearest vertex to a projected vertex is that vertex
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const hit = nearestScreenVertex(after.array, { count: after.count }, id, id, { width: 2, height: 2, x: (after.array[0] + 1), y: 1 - after.array[1], maxPx: 1e-6, eye: [0, 0, -10] });
    expect(hit).toBeTruthy();
    // (same screen point; z may differ: a vertex straight behind it projects there too)
    hit.world.slice(0, 2).forEach((v, i) => expect(v).toBeCloseTo(after.array[i], 6));
  });

  it("keeps an authored material's colour even when it looks like GLTFLoader's default", async () => {
    const { materials } = await prepareGLB(FREEZER);
    expect(materials.length).toBe(1);
    const m = materials[0];
    expect(m.name).toBe("");
    expect(m.userData.useThemeColor).toBe(false);
    expect(m.metalness).toBe(1); // untouched
    expect(m.color.getHexString()).not.toBe("ffffff");
  });

  it("marks GLTFLoader's real default material (no material in the file) for the theme colour, lines included", async () => {
    const glb = encodeGLB({
      meshes: [
        { name: "bare", positions: tri, normals: computeNormals(tri) },
        { name: "edge", positions: new Float32Array([0, 0, 0, 1, 1, 1]), mode: MODE.LINES },
        { name: "painted", positions: tri, normals: computeNormals(tri), color: "#ff0000" },
      ],
    });
    const gltf = await loadGLTF(glb);
    const mats = prepareMaterials(gltf.scene, gltf.parser);
    const byMesh = {};
    gltf.scene.traverse((o) => o.material && (byMesh[o.name] = o.material));
    expect(byMesh.bare.userData.useThemeColor).toBe(true);
    expect(byMesh.bare.metalness).toBe(0);
    expect(byMesh.edge.userData.useThemeColor).toBe(true);
    expect(byMesh.painted.userData.useThemeColor).toBe(false);
    expect(authoredMaterials(gltf.parser).has(byMesh.painted)).toBe(true);
    expect(mats.length).toBe(3);
  });

  it("keeps an authored colour on LINES primitives, with and without vertex colours (Line/Points materials are derived)", async () => {
    const seg = new Float32Array([0, 0, 0, 1, 0, 0]);
    const glb = encodeGLB({
      meshes: [
        { name: "dwl", positions: seg, mode: MODE.LINES, color: "#2563eb" },
        { name: "streamline", positions: seg, mode: MODE.LINES, color: "#ffffff", attributes: { _C: { array: new Float32Array([1, 0, 0, 0, 0, 1]), itemSize: 3 } } },
        { name: "bare", positions: seg, mode: MODE.LINES },
        { name: "dots", positions: seg, mode: MODE.POINTS, color: "#00ff00" },
      ],
    });
    // glb.js only writes "_" attributes: rename _C to COLOR_0 (same byte layout), then repack
    const { json, bin } = parseGLB(glb);
    for (const m of json.meshes) for (const p of m.primitives) if (p.attributes._C !== undefined) (p.attributes.COLOR_0 = p.attributes._C), delete p.attributes._C;
    const gltf = await loadGLTF(packGLB(json, bin));
    prepareMaterials(gltf.scene, gltf.parser);
    const byName = {};
    gltf.scene.traverse((o) => o.material && (byName[o.name] = o));
    expect(byName.dwl.isLine).toBe(true);
    expect(byName.dwl.material.isLineBasicMaterial).toBe(true);
    expect(byName.dwl.material.userData.useThemeColor).toBe(false);
    expect(byName.dwl.material.color.getHexString(SRGB)).toBe("2563eb");
    expect(byName.streamline.material.vertexColors).toBe(true);
    expect(byName.streamline.material.userData.useThemeColor).toBe(false);
    expect(byName.dots.material.isPointsMaterial).toBe(true);
    expect(byName.dots.material.userData.useThemeColor).toBe(false);
    // no material in the file: still the theme colour
    expect(byName.bare.material.userData.useThemeColor).toBe(true);
    expect(authoredMaterials(gltf.parser, gltf.scene).has(byName.dwl.material)).toBe(true);
    expect(authoredMaterials(gltf.parser, gltf.scene).has(byName.bare.material)).toBe(false);
  });

  it("leaves a mirrored placement of a shared mesh as a plain Mesh (three picks winding per object, not per instance)", async () => {
    const glb = encodeGLB({
      meshes: [{ name: "fitting", positions: tri, normals: computeNormals(tri), color: "#808080" }],
      nodes: [
        { name: "a", mesh: 0, translation: [0, 0, 0] },
        { name: "b", mesh: 0, translation: [2, 0, 0] },
        { name: "mirror", mesh: 0, translation: [-2, 0, 0], scale: [-1, 1, 1] },
      ],
    });
    const gltf = await loadGLTF(glb);
    const r = collapseInstances(gltf.scene);
    expect(r).toEqual({ before: 3, after: 2, instanced: 1 });
    const plain = [];
    gltf.scene.traverse((o) => o.isMesh && !o.isInstancedMesh && plain.push(o));
    expect(plain.length).toBe(1);
    expect(plain[0].matrixWorld.determinant()).toBeLessThan(0);
  });

  it("boxes each piece under a rotation, like setFromObject, instead of rotating one box of the whole", async () => {
    // an L: a 2 m bar along x and a 2 m bar along z, as two meshes
    const bar = (sx, sz) => {
      const p = [];
      const q = [[0, 0], [sx, 0], [sx, sz], [0, sz]];
      for (const [x, z] of q) p.push(x, 0, z);
      for (const [x, z] of q) p.push(x, 0.1, z);
      return new Float32Array(p);
    };
    const glb = encodeGLB({ meshes: [{ name: "x", positions: bar(2, 0.1), indices: [0, 1, 2, 0, 2, 3] }, { name: "z", positions: bar(0.1, 2), indices: [0, 1, 2, 0, 2, 3] }] });
    const out = await prepareGLB(glb);
    expect(out.parts.length).toBe(2);
    const body = new Group();
    body.add(out.content);
    body.rotation.set(0, Math.PI / 4, 0);
    body.updateMatrixWorld(true);
    const perPiece = new Box3();
    const m = new Matrix4();
    for (const p of out.parts) perPiece.union(p.box.clone().applyMatrix4(m.multiplyMatrices(body.matrixWorld, p.matrix)));
    const three = new Box3().setFromObject(body);
    for (const k of ["min", "max"]) perPiece[k].toArray().forEach((v, i) => expect(v).toBeCloseTo(three[k].getComponent(i), 9));
    const whole = out.box.clone().applyMatrix4(body.matrixWorld);
    const size = (b) => b.max.x - b.min.x;
    expect(size(perPiece)).toBeLessThan(size(whole) - 0.5); // 1.49 m, not 2.9 m
    // instances count as pieces too
    const cell = await prepareGLB(CELL);
    expect(localParts(cell.content).length).toBe(8);
  });

  it("collapses a mesh reused by 8 nodes into one InstancedMesh, same world placement", async () => {
    const gltf = await loadGLTF(CELL);
    gltf.scene.updateMatrixWorld(true);
    const worlds = [];
    gltf.scene.traverse((o) => o.isMesh && worlds.push(o.matrixWorld.clone()));
    expect(worlds.length).toBe(8);
    const r = collapseInstances(gltf.scene);
    expect(r).toEqual({ before: 8, after: 1, instanced: 1 });
    const inst = [];
    gltf.scene.traverse((o) => o.isMesh && inst.push(o));
    expect(inst.length).toBe(1);
    expect(inst[0].isInstancedMesh).toBe(true);
    expect(inst[0].count).toBe(8);
    const got = [];
    const m = inst[0].matrixWorld.clone();
    for (let i = 0; i < 8; i++) {
      const mi = new m.constructor();
      inst[0].getMatrixAt(i, mi);
      got.push(mi.premultiply(m).elements.map((v) => Math.round(v * 1e6)));
    }
    const want = worlds.map((w) => w.elements.map((v) => Math.round(v * 1e6)));
    expect(got.map(String).sort()).toEqual(want.map(String).sort());
  });

  it("prepareGLB reports draw calls, triangles, legend and a local box", async () => {
    const out = await prepareGLB(CELL);
    expect(out.stats.drawCalls).toBe(1);
    expect(out.stats.nodes).toBe(8);
    expect(out.stats.triangles).toBeGreaterThan(0);
    expect(out.box).toBeTruthy();
    expect(out.legend).toBeNull();
  });

  it("applies material rules over the GLB values, and re-applies from scratch when they change", async () => {
    const glb = encodeGLB({
      meshes: [
        { name: "a", positions: tri, normals: computeNormals(tri), color: "#808080", materialName: "Aluminum 6061" },
        { name: "b", positions: tri, normals: computeNormals(tri) },
      ],
    });
    const gltf = await loadGLTF(glb);
    const mats = prepareMaterials(gltf.scene, gltf.parser);
    const alu = mats.find((m) => !m.userData.useThemeColor);
    const def = mats.find((m) => m.userData.useThemeColor);
    alu.name = "Aluminum 6061"; // (in case the encoder doesn't name materials)
    const rough0 = alu.roughness;
    applyMaterialRules(mats, sanitizeRules([{ match: { nameIncludes: "Alum" }, set: { metalness: 1, roughness: 0.2, opacity: 0.5 } }, { match: { unnamed: true }, set: { color: "#00ff00" } }]));
    expect(alu.metalness).toBe(1);
    expect(alu.roughness).toBeCloseTo(0.2);
    expect(alu.userData.baseOpacity).toBe(0.5);
    expect(alu.userData.baseTransparent).toBe(true);
    // the default material is "no material": rules never touch it
    expect(def.color.getHexString()).toBe("ffffff");
    applyMaterialRules(mats, []);
    expect(alu.roughness).toBeCloseTo(rough0);
    expect(alu.userData.baseOpacity).toBe(1);
    expect(alu.userData.baseTransparent).toBe(false);
  });
});

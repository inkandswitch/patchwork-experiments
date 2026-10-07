// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { encodeGLB, parseGLB, computeNormals, computeBounds, hexToLinear, MODE } from "./glb.js";

function load(bytes) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, "", resolve, reject));
}

const tri = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
};

const quad = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  indices: [0, 1, 2, 0, 2, 3],
});

describe("encodeGLB structure", () => {
  it("writes a valid header, aligned chunks and POSITION min/max", () => {
    const bytes = encodeGLB({ meshes: [{ name: "tri", ...tri }] });
    expect(bytes.byteLength % 4).toBe(0);
    const { json, bin } = parseGLB(bytes);
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes[0].name).toBe("tri");
    const pos = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.min).toEqual([0, 0, 0]);
    expect(pos.max).toEqual([1, 1, 0]);
    expect(pos.count).toBe(3);
    expect(bin.byteLength % 4).toBe(0);
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  it("uses u16 indices when they fit and u32 when they do not", () => {
    const small = parseGLB(encodeGLB({ meshes: [quad()] })).json;
    expect(small.accessors[small.meshes[0].primitives[0].indices].componentType).toBe(5123);

    const n = 70000;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) positions[i * 3] = i;
    const indices = new Uint32Array([0, 1, n - 1]);
    const big = parseGLB(encodeGLB({ meshes: [{ positions, indices }] })).json;
    expect(big.accessors[big.meshes[0].primitives[0].indices].componentType).toBe(5125);
  });

  it("keeps odd-length u16 index data aligned for the next view", () => {
    const bytes = encodeGLB({
      meshes: [
        { positions: tri.positions, indices: [0, 1, 2] }, // 6 bytes of indices
        { positions: tri.positions },
      ],
    });
    const { json } = parseGLB(bytes);
    for (const v of json.bufferViews) expect(v.byteOffset % 4).toBe(0);
  });

  it("drops empty primitives and meshes but still encodes a valid scene", () => {
    const bytes = encodeGLB({ meshes: [{ name: "empty", positions: [] }] });
    const { json, bin } = parseGLB(bytes);
    expect(json.meshes).toBeUndefined();
    expect(json.nodes).toEqual([{ name: "empty" }]);
    expect(bin).toBeNull();
  });

  it("rejects malformed input with a useful message", () => {
    expect(() => encodeGLB({ meshes: [{ name: "bad", positions: [0, 0] }] })).toThrow(/bad.*multiple of 3/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions, indices: [0, 1, 3] }] })).toThrow(/out of range/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions, attributes: { ID: [1, 2, 3] } }] })).toThrow(/start with "_"/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions, attributes: { _ID: [1, 2] } }] })).toThrow(/expected 3/);
    expect(() => encodeGLB({ meshes: [{ positions: [0, 0, NaN] }] })).toThrow(/non-finite/);
    expect(() => encodeGLB({ meshes: [{ positions: tri.positions }], nodes: [{ mesh: 4 }] })).toThrow(/does not exist/);
  });

  it("dedupes identical materials and linearises hex colours", () => {
    const { json } = parseGLB(
      encodeGLB({
        meshes: [
          { ...tri, color: "#ff0000" },
          { ...tri, color: "#ff0000" },
          { ...tri, color: [0, 0, 1, 0.5] },
        ],
      }),
    );
    expect(json.materials.length).toBe(2);
    expect(json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0, 1]);
    expect(json.materials[1].alphaMode).toBe("BLEND");
    expect(hexToLinear("#808080")[0]).toBeCloseTo(0.2158, 3);
  });
});

describe("encodeGLB round-trips through three's GLTFLoader", () => {
  it("loads meshes, names, normals, indices and custom attributes", async () => {
    const q = quad();
    const bytes = encodeGLB({
      meshes: [
        {
          name: "hull",
          positions: q.positions,
          indices: q.indices,
          normals: computeNormals(q.positions, q.indices),
          attributes: { _ID: new Float32Array([0, 0, 1, 1]), _UV2: { array: new Float32Array(8), itemSize: 2 } },
          color: [0.2, 0.4, 0.6],
        },
        { name: "edges", positions: q.positions, indices: [0, 1, 1, 2, 2, 3, 3, 0], mode: MODE.LINES },
      ],
    });
    const gltf = await load(bytes);
    const hull = gltf.scene.getObjectByName("hull");
    expect(hull.isMesh).toBe(true);
    const g = hull.geometry;
    expect(g.getAttribute("position").count).toBe(4);
    expect(g.getAttribute("normal").getZ(0)).toBeCloseTo(1);
    expect(g.index.count).toBe(6);
    // three lower-cases custom attribute names
    expect([...g.getAttribute("_id").array]).toEqual([0, 0, 1, 1]);
    expect(g.getAttribute("_uv2").itemSize).toBe(2);
    expect(hull.material.color.r).toBeCloseTo(0.2);
    const edges = gltf.scene.getObjectByName("edges");
    expect(edges.isLineSegments).toBe(true);
  });

  it("honours explicit node hierarchies and transforms", async () => {
    const bytes = encodeGLB({
      meshes: [{ name: "part", ...tri }],
      nodes: [
        { name: "assembly", children: [1, 2], translation: [0, 2, 0] },
        { name: "left", mesh: 0, translation: [-1, 0, 0] },
        { name: "right", mesh: 0, translation: [1, 0, 0], scale: [2, 2, 2] },
      ],
    });
    const { json } = parseGLB(bytes);
    expect(json.scenes[0].nodes).toEqual([0]);
    const gltf = await load(bytes);
    gltf.scene.updateMatrixWorld(true);
    const right = gltf.scene.getObjectByName("right");
    const p = right.getWorldPosition(right.position.clone());
    expect([p.x, p.y, p.z]).toEqual([1, 2, 0]);
    expect(gltf.scene.getObjectByName("left")).toBeTruthy();
  });

  it("loads an empty scene", async () => {
    const gltf = await load(encodeGLB({ meshes: [] }));
    expect(gltf.scene.children.length).toBe(0);
  });
});

describe("helpers", () => {
  it("computes flat normals for triangle soup", () => {
    const n = computeNormals(tri.positions);
    expect([...n]).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });
  it("computes bounds", () => {
    expect(computeBounds([1, 2, 3, -1, 5, 0])).toEqual({ min: [-1, 2, 0], max: [1, 5, 3] });
    expect(computeBounds([])).toBeNull();
  });
});

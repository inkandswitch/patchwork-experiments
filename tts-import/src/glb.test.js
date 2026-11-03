// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { encodeGLB, parseGLB, computeNormals, computeBounds, hexToLinear, MODE } from "./glb.js";
import { decodePNG, solidPNG } from "./test/png.js";

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

// ─── textures (this package's extension) ─────────────────────────────────────

// three's GLTFLoader decodes images with createImageBitmap (fetching a blob:
// URL of the embedded bytes). Node has neither a decoder nor a canvas, so stand
// one in that reads the PNG we embedded and records what it was given.
const decoded = [];
function installImageDecoder() {
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = decodePNG(bytes);
    decoded.push({ type: blob.type, width: img.width, height: img.height, data: img.data });
    return { width: img.width, height: img.height, close() {} };
  };
}

const quadUV = () => ({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, -1, 0, 0, -1]),
  uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  indices: [0, 1, 2, 0, 2, 3],
});

describe("encodeGLB textures", () => {
  const red = solidPNG(4, 2, [255, 0, 0, 255]);
  const blue = solidPNG(2, 2, [0, 0, 255, 128]);

  it("embeds images in bufferViews and writes textures, samplers and TEXCOORD_0", () => {
    const { json, bin } = parseGLB(
      encodeGLB({
        images: [{ bytes: red, mimeType: "image/png", name: "face" }, { bytes: blue, mimeType: "image/png" }],
        meshes: [
          { name: "top", ...quadUV(), texture: 0 },
          { name: "top again", ...quadUV(), texture: { image: 0 } },
          { name: "bottom", ...quadUV(), texture: { image: 1, wrap: "clamp", transform: { offset: [0.5, 0], scale: [0.5, 1] } }, alphaMode: "MASK", alphaCutoff: 0.4 },
        ],
      }),
    );
    expect(json.images).toHaveLength(2);
    expect(json.images[0]).toMatchObject({ mimeType: "image/png", name: "face" });
    const view = json.bufferViews[json.images[0].bufferView];
    expect(view.target).toBeUndefined();
    expect([...bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)]).toEqual([...red]);
    expect(json.textures).toHaveLength(2); // the same image + sampler is one texture
    expect(json.samplers.map((s) => s.wrapS)).toEqual([10497, 33071]);
    const prim = json.meshes[0].primitives[0];
    expect(json.accessors[prim.attributes.TEXCOORD_0]).toMatchObject({ type: "VEC2", count: 4 });
    expect(json.materials[prim.material].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    // identical textured materials are one material
    expect(json.meshes[1].primitives[0].material).toBe(prim.material);
    const mask = json.materials[json.meshes[2].primitives[0].material];
    expect(mask.alphaMode).toBe("MASK");
    expect(mask.alphaCutoff).toBe(0.4);
    expect(mask.pbrMetallicRoughness.baseColorTexture.extensions.KHR_texture_transform).toEqual({ offset: [0.5, 0], scale: [0.5, 1] });
    expect(json.extensionsUsed).toEqual(["KHR_texture_transform"]);
  });

  it("rejects what it can't embed", () => {
    expect(() => encodeGLB({ meshes: [{ ...quadUV(), texture: 0 }] })).toThrow(/image 0, which does not exist/);
    expect(() => encodeGLB({ images: [{ bytes: red, mimeType: "image/webp" }], meshes: [{ ...quadUV(), texture: 0 }] })).toThrow(/png and image\/jpeg/);
    const { uvs, ...noUV } = quadUV();
    expect(() => encodeGLB({ images: [{ bytes: red, mimeType: "image/png" }], meshes: [{ ...noUV, texture: 0 }] })).toThrow(/no uvs/);
    expect(() => encodeGLB({ meshes: [{ ...quadUV(), uvs: [0, 0] }] })).toThrow(/expected 8/);
  });

  it("round-trips through three's GLTFLoader: map, uvs, wrap, texture transform, unlit", async () => {
    installImageDecoder();
    decoded.length = 0;
    const bytes = encodeGLB({
      images: [{ bytes: red, mimeType: "image/png" }, { bytes: blue, mimeType: "image/png" }],
      meshes: [
        { name: "face", ...quadUV(), texture: 0, roughness: 0.5 },
        { name: "back", ...quadUV(), texture: { image: 1, wrap: "clamp", transform: { offset: [0.25, 0.5], scale: [0.5, 0.5] } }, alphaMode: "MASK", unlit: true },
      ],
    });
    const gltf = await load(bytes);
    const face = gltf.scene.getObjectByName("face");
    const back = gltf.scene.getObjectByName("back");
    expect([...face.geometry.getAttribute("uv").array]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    const map = face.material.map;
    expect(map).toBeTruthy();
    expect(map.image.width).toBe(4);
    expect(map.image.height).toBe(2);
    expect(map.flipY).toBe(false);
    expect(map.colorSpace).toBe("srgb");
    expect(map.wrapS).toBe(1000); // RepeatWrapping
    expect(face.material.roughness).toBeCloseTo(0.5);
    const bmap = back.material.map;
    expect(bmap.wrapS).toBe(1001); // ClampToEdgeWrapping
    expect([bmap.offset.x, bmap.offset.y]).toEqual([0.25, 0.5]);
    expect([bmap.repeat.x, bmap.repeat.y]).toEqual([0.5, 0.5]);
    expect(back.material.alphaTest).toBe(0.5);
    expect(back.material.isMeshBasicMaterial).toBe(true); // unlit
    // the decoder saw our own pixels
    expect(decoded.map((d) => [d.type, d.width, d.height])).toEqual(expect.arrayContaining([["image/png", 4, 2], ["image/png", 2, 2]]));
    expect([...decoded.find((d) => d.width === 4).data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
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

// A glTF 2.0 binary (GLB) writer for palette art: unlit triangles with
// embedded PNG textures, sampled NEAREST (pixels stay pixels up close), and a
// per-vertex colour (COLOR_0) that the texture is multiplied by (the light
// baked into a Doom sector). Not the scene's kit encoder (scene/src/glb.js,
// which has no textures): written for this package, in the same conventions
// (Y-up metres, asset.extras.units, asset.copyright).
//
//   encodeGLB({
//     meshes: [{ name, primitives: [{ positions, uvs?, colors?, indices, material }] }],
//     nodes?: [{ name, mesh?, translation?, children?, extras? }],   // default: one root node per mesh
//     materials: [{ name, image?, color?, alphaMask?: boolean }],   // image: index into images
//     images: [{ name, bytes, mimeType: "image/png" }],
//     extras?, copyright?, generator?
//   }) → Uint8Array
//   parseGLB(bytes) → { json, bin }   (for tests)

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
// NEAREST up close; between mip levels far off, so a distant wall doesn't crawl
export const SAMPLER = { magFilter: 9728, minFilter: 9986, wrapS: 10497, wrapT: 10497 };

const align4 = (n) => (n + 3) & ~3;

export function encodeGLB({ meshes, nodes, materials = [], images = [], extras, copyright, generator = "patchwork doom" }) {
  const chunks = [];
  let length = 0;
  const views = [];
  const accessors = [];
  const view = (bytes, target) => {
    const at = length;
    chunks.push({ at, bytes });
    length = align4(at + bytes.byteLength);
    views.push({ buffer: 0, byteOffset: at, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    return views.length - 1;
  };
  const floats = (arr, size, withBounds) => {
    const f = arr instanceof Float32Array ? arr : Float32Array.from(arr);
    const count = f.length / size;
    if (!Number.isInteger(count)) throw new Error(`glb: ${f.length} floats is not a whole number of ${size}s`);
    const acc = { bufferView: view(new Uint8Array(f.buffer, f.byteOffset, f.byteLength), ARRAY_BUFFER), componentType: FLOAT, count, type: ["SCALAR", "VEC2", "VEC3", "VEC4"][size - 1] };
    if (withBounds) {
      const min = Array(size).fill(Infinity);
      const max = Array(size).fill(-Infinity);
      for (let i = 0; i < f.length; i++) {
        const k = i % size;
        if (f[i] < min[k]) min[k] = f[i];
        if (f[i] > max[k]) max[k] = f[i];
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const indexAccessor = (idx, vertices) => {
    for (const i of idx) if (!(i >= 0 && i < vertices)) throw new Error(`glb: index ${i} is outside ${vertices} vertices`);
    const big = vertices > 65535;
    const a = big ? Uint32Array.from(idx) : Uint16Array.from(idx);
    accessors.push({ bufferView: view(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), ELEMENT_ARRAY_BUFFER), componentType: big ? UNSIGNED_INT : UNSIGNED_SHORT, count: a.length, type: "SCALAR" });
    return accessors.length - 1;
  };

  const gltfImages = images.map((img) => {
    if (img.mimeType !== "image/png" || !(img.bytes instanceof Uint8Array)) throw new Error("glb: images are PNG bytes");
    return { name: img.name, mimeType: img.mimeType, bufferView: view(img.bytes) };
  });
  const textures = images.map((_, i) => ({ source: i, sampler: 0 }));
  const gltfMaterials = materials.map((m) => {
    const pbr = { baseColorFactor: m.color ?? [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 };
    if (m.image != null) {
      if (!(m.image >= 0 && m.image < images.length)) throw new Error(`glb: material ${m.name} names image ${m.image}, which isn't there`);
      pbr.baseColorTexture = { index: m.image };
    }
    return { name: m.name, pbrMetallicRoughness: pbr, doubleSided: true, ...(m.alphaMask ? { alphaMode: "MASK", alphaCutoff: 0.5 } : {}), extensions: { KHR_materials_unlit: {} } };
  });

  const gltfMeshes = [];
  const meshIndex = new Map();
  meshes.forEach((mesh, mi) => {
    const prims = [];
    for (const p of mesh.primitives) {
      const n = p.positions.length / 3;
      if (!n || !p.indices.length) continue;
      if (!(p.material >= 0 && p.material < materials.length)) throw new Error(`glb: mesh ${mesh.name} names material ${p.material}, which isn't there`);
      const attributes = { POSITION: floats(p.positions, 3, true) };
      if (p.uvs) {
        if (p.uvs.length !== n * 2) throw new Error(`glb: mesh ${mesh.name} has ${p.uvs.length / 2} uvs for ${n} vertices`);
        attributes.TEXCOORD_0 = floats(p.uvs, 2);
      }
      if (p.colors) {
        if (p.colors.length !== n * 3) throw new Error(`glb: mesh ${mesh.name} has ${p.colors.length / 3} colours for ${n} vertices`);
        attributes.COLOR_0 = floats(p.colors, 3);
      }
      prims.push({ attributes, indices: indexAccessor(p.indices, n), material: p.material, mode: 4 });
    }
    if (!prims.length) return;
    meshIndex.set(mi, gltfMeshes.length);
    gltfMeshes.push({ name: mesh.name, primitives: prims });
  });
  const gltfNodes = (nodes ?? meshes.map((m, i) => ({ name: m.name, mesh: i }))).map((nd) => {
    const out = { ...(nd.name ? { name: nd.name } : {}) };
    if (nd.mesh != null && meshIndex.has(nd.mesh)) out.mesh = meshIndex.get(nd.mesh);
    if (nd.translation) out.translation = nd.translation;
    if (nd.children?.length) out.children = nd.children;
    if (nd.extras) out.extras = nd.extras;
    return out;
  });
  const child = new Set(gltfNodes.flatMap((n) => n.children ?? []));

  const json = {
    asset: { version: "2.0", generator, ...(copyright ? { copyright } : {}), extras: { units: "m" } },
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i).filter((i) => !child.has(i)), ...(extras ? { extras } : {}) }],
    nodes: gltfNodes,
    ...(gltfMeshes.length ? { meshes: gltfMeshes } : {}),
    ...(gltfMaterials.length ? { materials: gltfMaterials, extensionsUsed: ["KHR_materials_unlit"] } : {}),
    ...(images.length ? { images: gltfImages, textures, samplers: [SAMPLER] } : {}),
    ...(accessors.length ? { accessors, bufferViews: views, buffers: [{ byteLength: length }] } : {}),
  };
  const bin = new Uint8Array(length);
  for (const c of chunks) bin.set(c.bytes, c.at);
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = align4(jsonBytes.length);
  const total = 12 + 8 + jsonLen + (length ? 8 + length : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  if (length) {
    dv.setUint32(20 + jsonLen, length, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true); // "BIN"
    out.set(bin, 28 + jsonLen);
  }
  return out;
}

/** The JSON and BIN chunks of a GLB. */
export function parseGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB");
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const bin = bytes.byteLength > 20 + jsonLen ? bytes.subarray(28 + jsonLen, 28 + jsonLen + dv.getUint32(20 + jsonLen, true)) : null;
  return { json, bin };
}

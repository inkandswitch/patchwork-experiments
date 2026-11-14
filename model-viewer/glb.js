// Minimal GLB (glTF 2.0 binary) encoder: indexed triangle meshes with normals
// and a flat base colour per mesh. Same conventions as the scene kit's glb.js
// (Y-up, metres, asset.extras.units = "m").

export function computeBounds(p) {
  if (p.length < 3) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max };
}

export function computeNormals(p, idx) {
  const out = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2]);
    if (l > 0) { out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; } else out[i + 1] = 1;
  }
  return out;
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexToLinear(h) {
  h = h.replace(/^#/, "");
  const n = (i) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [lin(n(0)), lin(n(2)), lin(n(4)), 1];
}

export function encodeGLB({ meshes, generator = "patchwork glb" }) {
  const parts = [], views = [], accessors = [], gMeshes = [], materials = [], nodes = [];
  let len = 0;
  const add = (typed, target) => {
    const pad = (4 - (len % 4)) % 4;
    if (pad) { parts.push(new Uint8Array(pad)); len += pad; }
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    views.push({ buffer: 0, byteOffset: len, byteLength: bytes.byteLength, target });
    parts.push(bytes); len += bytes.byteLength;
    return views.length - 1;
  };
  for (const m of meshes) {
    const count = m.positions.length / 3;
    if (!count) continue;
    const b = computeBounds(m.positions);
    accessors.push({ bufferView: add(m.positions, 34962), componentType: 5126, count, type: "VEC3", min: b.min, max: b.max });
    const attributes = { POSITION: accessors.length - 1 };
    if (m.normals) {
      accessors.push({ bufferView: add(m.normals, 34962), componentType: 5126, count, type: "VEC3" });
      attributes.NORMAL = accessors.length - 1;
    }
    const prim = { attributes, mode: 4 };
    if (m.indices?.length) {
      const ix = count < 65536 ? Uint16Array.from(m.indices) : m.indices;
      accessors.push({ bufferView: add(ix, 34963), componentType: ix instanceof Uint16Array ? 5123 : 5125, count: ix.length, type: "SCALAR" });
      prim.indices = accessors.length - 1;
    }
    materials.push({
      pbrMetallicRoughness: { baseColorFactor: m.color ? hexToLinear(m.color) : [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: m.roughness ?? 0.8 },
      doubleSided: true,
    });
    prim.material = materials.length - 1;
    gMeshes.push({ name: m.name, primitives: [prim] });
    nodes.push({ name: m.name, mesh: gMeshes.length - 1 });
  }
  const binLen = len + ((4 - (len % 4)) % 4);
  const bin = new Uint8Array(binLen);
  let off = 0;
  for (const p of parts) { bin.set(p, off); off += p.byteLength; }
  const gltf = {
    asset: { version: "2.0", generator, extras: { units: "m" } },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
  };
  if (nodes.length) { gltf.nodes = nodes; gltf.meshes = gMeshes; gltf.materials = materials; gltf.accessors = accessors; gltf.bufferViews = views; gltf.buffers = [{ byteLength: binLen }]; }
  const jsonRaw = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLen = jsonRaw.byteLength + ((4 - (jsonRaw.byteLength % 4)) % 4);
  const hasBin = binLen > 0;
  const total = 20 + jsonLen + (hasBin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonRaw, 20); out.fill(0x20, 20 + jsonRaw.byteLength, 20 + jsonLen);
  if (hasBin) { dv.setUint32(20 + jsonLen, binLen, true); dv.setUint32(24 + jsonLen, 0x004e4942, true); out.set(bin, 28 + jsonLen); }
  return out;
}

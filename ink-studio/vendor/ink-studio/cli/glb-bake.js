// Rasterize source appearance into the finished atlas, with padding for texture filtering.
const png = require('./png');
const { area2 } = require('./glb-uv');

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const byte = value => Math.round(clamp(value) * 255);
const sRGB = v => byte(v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function bake(mesh, faces, uvs, normals, size, padding, { V }) {
  const count = size * size, covered = new Uint8Array(count);
  const pixels = {
    base: new Uint8Array(count * 3), normal: new Uint8Array(count * 3),
    surface: new Uint8Array(count * 3), emission: new Uint8Array(count * 3)
  };
  let used = 0, strength = 1, normalUsed = false, emissiveUsed = false, surfaceUsed = false;
  const hot = new Float32Array(count * 3), mats = mesh.materials;
  for (const [f, face] of faces.entries()) {
    const t = uvs[f].map(p => p.map(x => x * size)), [a, b, c] = t, det = area2(a, b, c);
    if (Math.abs(det) < 1e-16) throw new Error('Cannot bake a degenerate UV triangle');
    const [pa, pb, pc] = face.map(i => mesh.points[i]);
    const ab = V.sub(pb, pa), ac = V.sub(pc, pa);
    const [na, nb, nc] = mesh.cornerNormals?.[f] || face.map(i => normals[i]), normAB = V.sub(nb, na), normAC = V.sub(nc, na);
    const tangent = V.mul(V.sub(V.mul(ab, c[1] - a[1]), V.mul(ac, b[1] - a[1])), 1 / det);
    const bitangent = V.mul(V.sub(V.mul(ac, b[0] - a[0]), V.mul(ab, c[0] - a[0])), 1 / det);
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const x1 = Math.min(size, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y1 = Math.min(size, Math.ceil(Math.max(a[1], b[1], c[1])));
    const fallback = mats[mesh.faceMaterials?.[f] ?? 0];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const q = [x + 0.5, y + 0.5], u = area2(a, q, c) / det, v = area2(a, b, q) / det;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      const i = x + y * size;
      const interior = Math.min(u, v, 1 - u - v) > 1e-7;
      if (covered[i] === 2 && interior) throw new Error('UV islands overlap in the texture bake');
      if (covered[i]) continue;
      covered[i] = interior ? 2 : 1;
      used++;
      const n = V.norm(V.mad(V.mad(na, normAB, u), normAC, v));
      const p = V.mad(V.mad(pa, ab, u), ac, v);
      const material = mesh.sampleSurface?.(p, n, f) || fallback;
      const color = material.color || [0.45, 0.45, 0.45];
      const emission = material.emission || [0, 0, 0];
      const roughness = material.roughness ?? 0.8, metallic = material.metallic ?? 0;
      const source = material.normal || n;
      const tx = V.norm(V.mad(tangent, n, -V.dot(tangent, n)), V.perp(n));
      const ty = V.mul(V.cross(n, tx), V.dot(V.cross(n, tx), bitangent) < 0 ? -1 : 1);
      const yNormal = [V.dot(source, tx), V.dot(source, ty), V.dot(source, n)];
      const at = i * 3;
      pixels.base.set(color.map(sRGB), at);
      pixels.normal.set(yNormal.map(value => byte(0.5 + 0.5 * value)), at);
      pixels.surface.set([255, byte(roughness), byte(metallic)], at);
      hot.set(emission, at);
      normalUsed ||= V.dist(source, n) > 0.001;
      emissiveUsed ||= emission.some(value => value > 0);
      surfaceUsed ||= roughness !== 0.8 || metallic !== 0;
      strength = Math.max(strength, ...emission);
    }
  }
  if (!used) throw new Error('Texture bake found no surface in the UV atlas');
  if (!normalUsed) delete pixels.normal;
  if (!surfaceUsed) delete pixels.surface;
  if (!emissiveUsed) delete pixels.emission;
  else for (let i = 0; i < hot.length; i++) pixels.emission[i] = sRGB(hot[i] / strength);
  const layers = Object.values(pixels);
  // Expand a texel at a time, using only data from the previous pass.
  let front = [];
  for (let i = 0; i < count; i++) if (covered[i] &&
    ((i % size > 0 && !covered[i - 1]) || (i % size < size - 1 && !covered[i + 1]) ||
    (i >= size && !covered[i - size]) || (i < count - size && !covered[i + size]))) front.push(i);
  const copy = (i, j, next) => {
    if (covered[j]) return;
    covered[j] = 1;
    next.push(j);
    for (const layer of layers) {
      for (let k = 0; k < 3; k++) layer[j * 3 + k] = layer[i * 3 + k];
    }
  };
  for (let step = 0; step < padding && front.length; step++) {
    const next = [];
    for (const i of front) {
      if (i % size > 0) copy(i, i - 1, next);
      if (i % size < size - 1) copy(i, i + 1, next);
      if (i >= size) copy(i, i - size, next);
      if (i < count - size) copy(i, i + size, next);
    }
    front = next;
  }
  const textures = Object.fromEntries(Object.entries(pixels).map(([key, data]) => [key, png.encode(size, size, data)]));
  return { textures, strength, coverage: used / count };
}

module.exports = bake;

// Test geometry: boxes and prisms as triangle soups, GLBs (via the kit
// encoder) and STLs, and the Patchwork docs that hold them.
import { encodeGLB } from "../glb.js";

const BOX_INDICES = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];

function boxVerts(w, h, d) {
  return [[0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0], [0, 0, d], [w, 0, d], [w, h, d], [0, h, d]];
}

/** A Y-up box GLB from the kit encoder (writes asset.extras.units = "m" unless `units` says otherwise). */
export function boxGlb(w, h, d, { units } = {}) {
  const positions = new Float32Array(boxVerts(w, h, d).flat());
  return encodeGLB({ meshes: [{ name: "box", positions, indices: BOX_INDICES }], ...(units ? { units } : {}) });
}

/** Z-up box as a triangle soup. */
export function boxTris(w, h, d) {
  const v = boxVerts(w, h, d);
  const out = [];
  for (const i of BOX_INDICES) out.push(...v[i]);
  return new Float32Array(out);
}

/** Hexagonal prism, circumradius r, height h, centred on origin (matches cylinder($fn=6)). */
export function hexPrism(r, h) {
  const v = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    v.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const t = [];
  const tri = (a, b, c) => t.push(...a, ...b, ...c);
  for (let i = 0; i < 6; i++) {
    const a = v[i], b = v[(i + 1) % 6];
    tri([...a, 0], [...b, 0], [...b, h]);
    tri([...a, 0], [...b, h], [...a, h]);
    tri([0, 0, 0], [...b, 0], [...a, 0]);
    tri([0, 0, h], [...a, h], [...b, h]);
  }
  return new Float32Array(t);
}

export function toBinaryStl(tris) {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, tris[i * 9 + k], true);
  return new Uint8Array(buf);
}

export function fileDoc(name, content, extension = name.split(".").pop()) {
  return { "@patchwork": { type: "file" }, name, extension, mimeType: extension === "glb" ? "model/gltf-binary" : "model/stl", content };
}

/** A scene-render doc whose GLB is `glbUrl`. */
export function renderDoc({ title = "Part", parent = null, glbUrl = null } = {}) {
  return { "@patchwork": { type: "scene-render" }, title, parent, providerId: "test", params: {}, glbUrl, builtFrom: null, builtAt: null, bounds: null, status: "idle", error: null, pinned: false };
}

// Binary STL, the form a part is frozen in for a run: 80 bytes of header, a
// count, then 50 bytes a triangle (a normal, three corners, two spare bytes).
// Float32, so a part read back is within a ten-millionth of what was written.

/**
 * @param {Float64Array|Float32Array|number[]} triangles  9 numbers a triangle
 * @returns {Uint8Array}
 */
export function encodeSTL(triangles, { name = "part" } = {}) {
  const n = Math.floor(triangles.length / 9);
  const out = new Uint8Array(84 + n * 50);
  const dv = new DataView(out.buffer);
  // a binary STL's header must not begin "solid": readers take that for the text form
  const head = new TextEncoder().encode(`patchwork fea ${name}`.slice(0, 79));
  out.set(head);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const i = t * 9, o = 84 + t * 50;
    const ux = triangles[i + 3] - triangles[i], uy = triangles[i + 4] - triangles[i + 1], uz = triangles[i + 5] - triangles[i + 2];
    const vx = triangles[i + 6] - triangles[i], vy = triangles[i + 7] - triangles[i + 1], vz = triangles[i + 8] - triangles[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true);
    dv.setFloat32(o + 4, ny / l, true);
    dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, triangles[i + k], true);
  }
  return out;
}

/** @returns {Float64Array} 9 numbers a triangle */
export function decodeSTL(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.byteLength < 84) throw new Error("not a binary STL: too short");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(80, true);
  if (b.byteLength < 84 + n * 50) throw new Error(`not a binary STL: it says ${n} triangles and holds fewer`);
  const out = new Float64Array(n * 9);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) out[t * 9 + k] = dv.getFloat32(84 + t * 50 + 12 + k * 4, true);
  return out;
}

// Parse binary or ASCII STL into a Float32Array of triangles (9 floats each).
export function parseStl(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength >= 84) {
    const n = dv.getUint32(80, true)
    if (84 + n * 50 === bytes.byteLength) {
      const out = new Float32Array(n * 9)
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12
        for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(o + k * 4, true)
      }
      return out
    }
  }
  const text = new TextDecoder().decode(bytes)
  const nums = []
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  let m
  while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3])
  if (nums.length === 0 || nums.length % 9) throw new Error("Could not parse STL")
  return new Float32Array(nums)
}

export function bounds(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}

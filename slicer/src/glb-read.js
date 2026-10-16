// Minimal GLB (binary glTF 2.0) reader: flattens every triangle primitive in the
// default scene into one triangle soup (9 floats per triangle), applying node
// transforms. No materials, textures or animation; lines and points are skipped.
// (Not the kit's glb.js, which is an encoder; that one is only used by tests here.)

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const CSIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }

function readComp(dv, off, type, normalized) {
  switch (type) {
    case 5126: return dv.getFloat32(off, true)
    case 5125: return dv.getUint32(off, true)
    case 5123: { const v = dv.getUint16(off, true); return normalized ? v / 65535 : v }
    case 5122: { const v = dv.getInt16(off, true); return normalized ? Math.max(v / 32767, -1) : v }
    case 5121: { const v = dv.getUint8(off); return normalized ? v / 255 : v }
    case 5120: { const v = dv.getInt8(off); return normalized ? Math.max(v / 127, -1) : v }
    default: throw new Error("Unsupported accessor component type " + type)
  }
}

function b64(s) {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function mul(a, b) { // column-major 4x4: a * b
  const o = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return o
}

function compose(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]
}

export function parseGlb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20) throw new Error("Not a GLB file (too small)")
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB file (missing glTF header)")
  let json = null, bin = null, off = 12
  const total = Math.min(dv.getUint32(8, true), bytes.byteLength)
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    const body = bytes.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body))
    else if (type === 0x004e4942 && !bin) bin = body
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json) throw new Error("GLB has no JSON chunk")
  for (const ext of json.extensionsRequired || []) {
    if (/draco|meshopt/i.test(ext)) throw new Error(`GLB uses ${ext} compression, which the slicer can't read. Export it uncompressed.`)
  }

  const buffers = (json.buffers || []).map((b, i) => {
    if (b.uri) {
      const m = /^data:[^,]*;base64,(.*)$/.exec(b.uri)
      if (!m) throw new Error("GLB references external buffer " + b.uri)
      return b64(m[1])
    }
    if (i === 0 && bin) return bin
    throw new Error("GLB buffer " + i + " has no data")
  })

  function accessor(i) {
    const a = json.accessors[i]
    const n = COMP[a.type], size = CSIZE[a.componentType]
    const out = new Float64Array(a.count * n)
    if (a.bufferView === undefined) return { data: out, n }
    const bv = json.bufferViews[a.bufferView]
    const buf = buffers[bv.buffer]
    const base = buf.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0)
    const stride = bv.byteStride || size * n
    const bdv = new DataView(buf.buffer)
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
      out[k * n + c] = readComp(bdv, base + k * stride + c * size, a.componentType, a.normalized)
    }
    return { data: out, n }
  }

  const chunks = []
  function emit(prim, M) {
    const mode = prim.mode ?? 4
    if (mode < 4 || prim.attributes?.POSITION === undefined) return
    const P = accessor(prim.attributes.POSITION).data
    const idx = prim.indices !== undefined ? accessor(prim.indices).data : null
    const count = idx ? idx.length : P.length / 3
    let tri = []
    if (mode === 4) for (let i = 0; i + 2 < count; i += 3) tri.push(i, i + 1, i + 2)
    else if (mode === 5) for (let i = 0; i + 2 < count; i++) tri.push(...(i % 2 ? [i + 1, i, i + 2] : [i, i + 1, i + 2]))
    else for (let i = 1; i + 1 < count; i++) tri.push(0, i, i + 1)
    const out = new Float32Array(tri.length * 3)
    for (let k = 0; k < tri.length; k++) {
      const v = idx ? idx[tri[k]] : tri[k]
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]
      out[k * 3] = M[0] * x + M[4] * y + M[8] * z + M[12]
      out[k * 3 + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]
      out[k * 3 + 2] = M[2] * x + M[6] * y + M[10] * z + M[14]
    }
    chunks.push(out)
  }

  const I = compose()
  function walk(ni, parent, depth) {
    if (depth > 64) throw new Error("GLB node hierarchy is too deep")
    const node = json.nodes[ni]
    const M = mul(parent, node.matrix || compose(node.translation, node.rotation, node.scale))
    if (node.mesh !== undefined) for (const p of json.meshes[node.mesh].primitives) emit(p, M)
    for (const c of node.children || []) walk(c, M, depth + 1)
  }
  const nodes = json.nodes || []
  let roots
  if (json.scenes?.length) roots = json.scenes[json.scene ?? 0].nodes || []
  else {
    const child = new Set(nodes.flatMap((n) => n.children || []))
    roots = nodes.map((_, i) => i).filter((i) => !child.has(i))
  }
  for (const r of roots) walk(r, I, 0)

  const len = chunks.reduce((s, c) => s + c.length, 0)
  if (!len) throw new Error("GLB contains no triangle meshes")
  const tris = new Float32Array(len)
  let o = 0
  for (const c of chunks) { tris.set(c, o); o += c.length }
  const extras = { ...(json.scenes?.[json.scene ?? 0]?.extras || {}), ...(json.asset?.extras || {}) }
  return { tris, extras, units: typeof json.asset?.extras?.units === "string" ? json.asset.extras.units : null, meshCount: (json.meshes || []).length }
}

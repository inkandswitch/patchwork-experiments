// Slice a triangle mesh into closed polygon loops per layer.
// Output coordinates are integers in micrometres (Clipper units): SCALE = 1000.
export const SCALE = 1000

export function sliceMesh(tris, layerHeight, firstLayerHeight, zMin, zMax) {
  const layers = [] // {z, top}
  let top = zMin + firstLayerHeight
  layers.push({ z: zMin + firstLayerHeight / 2, top })
  while (top + layerHeight / 2 < zMax) {
    layers.push({ z: top + layerHeight / 2, top: top + layerHeight })
    top += layerHeight
  }
  const nTri = tris.length / 9
  const segs = layers.map(() => [])
  const zOf = (l) => layers[l].z
  for (let t = 0; t < nTri; t++) {
    const o = t * 9
    const z0 = tris[o + 2], z1 = tris[o + 5], z2 = tris[o + 8]
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2)
    if (lo === hi) continue
    // binary search first layer with z >= lo
    let a = 0, b = layers.length
    while (a < b) { const m = (a + b) >> 1; if (zOf(m) < lo) a = m + 1; else b = m }
    for (let l = a; l < layers.length && zOf(l) <= hi; l++) {
      const s = intersect(tris, o, zOf(l))
      if (s) segs[l].push(s)
    }
  }
  return layers.map((layer, i) => ({ ...layer, loops: chain(segs[i]) }))
}

function intersect(tris, o, z) {
  const pts = []
  for (let e = 0; e < 3; e++) {
    const a = o + e * 3, b = o + ((e + 1) % 3) * 3
    const za = tris[a + 2], zb = tris[b + 2]
    if ((za < z) === (zb < z)) continue
    const t = (z - za) / (zb - za)
    pts.push([tris[a] + t * (tris[b] - tris[a]), tris[a + 1] + t * (tris[b + 1] - tris[a + 1])])
  }
  if (pts.length !== 2) return null
  return pts
}

const key = (p) => Math.round(p[0] * SCALE) + "," + Math.round(p[1] * SCALE)

// Join unordered segments into loops via shared endpoints.
function chain(segs) {
  const map = new Map()
  const add = (k, i) => { const l = map.get(k); if (l) l.push(i); else map.set(k, [i]) }
  segs.forEach((s, i) => { add(key(s[0]), i); add(key(s[1]), i) })
  const used = new Uint8Array(segs.length)
  const loops = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const pts = [segs[i][0]]
    let cur = segs[i][1]
    for (;;) {
      pts.push(cur)
      const k = key(cur)
      const next = (map.get(k) || []).find((j) => !used[j])
      if (next === undefined) break
      used[next] = 1
      const s = segs[next]
      cur = key(s[0]) === k ? s[1] : s[0]
    }
    if (pts.length >= 4) loops.push(pts.slice(0, -1).map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) })))
  }
  return loops
}

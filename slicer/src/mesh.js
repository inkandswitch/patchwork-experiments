// Mesh health: count edges that are not shared by exactly two triangles (0 = watertight).
export function openEdges(tris) {
  const ids = new Map()
  const id = (i) => {
    const k = Math.round(tris[i] * 1e4) + "," + Math.round(tris[i + 1] * 1e4) + "," + Math.round(tris[i + 2] * 1e4)
    let v = ids.get(k)
    if (v === undefined) { v = ids.size; ids.set(k, v) }
    return v
  }
  const edges = new Map()
  const add = (a, b) => {
    const k = a < b ? a * 4294967296 + b : b * 4294967296 + a
    edges.set(k, (edges.get(k) || 0) + 1)
  }
  for (let t = 0; t < tris.length; t += 9) {
    const a = id(t), b = id(t + 3), c = id(t + 6)
    if (a === b || b === c || a === c) continue
    add(a, b); add(b, c); add(c, a)
  }
  let open = 0
  for (const n of edges.values()) if (n !== 2) open++
  return open
}

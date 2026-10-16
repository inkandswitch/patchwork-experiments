// Turn sliced layers into toolpaths: walls, solid skins (top/bottom) and sparse infill.
import * as CL from "clipper-lib"
import { sliceMesh, SCALE } from "./slice.js"
import { bounds } from "./stl.js"

const C = CL.default || CL
const PT = C.PolyFillType, CT = C.ClipType, PY = C.PolyType

export function offset(paths, deltaMm) {
  if (!paths.length) return []
  const co = new C.ClipperOffset(2, 0.05 * SCALE)
  co.AddPaths(paths, C.JoinType.jtRound, C.EndType.etClosedPolygon)
  const out = new C.Paths()
  co.Execute(out, deltaMm * SCALE)
  return out
}

export function boolean(type, subj, clip) {
  if (!subj.length) return []
  const c = new C.Clipper()
  c.AddPaths(subj, PY.ptSubject, true)
  if (clip.length) c.AddPaths(clip, PY.ptClip, true)
  const out = new C.Paths()
  c.Execute(type, out, PT.pftNonZero, PT.pftNonZero)
  return out
}

function clipLines(lines, region) {
  const c = new C.Clipper()
  c.AddPaths(lines, PY.ptSubject, false)
  c.AddPaths(region, PY.ptClip, true)
  const tree = new C.PolyTree()
  c.Execute(CT.ctIntersection, tree, PT.pftNonZero, PT.pftNonZero)
  return C.Clipper.OpenPathsFromPolyTree(tree)
}

// Parallel lines at `angle`, `spacing` mm apart, anchored to the origin so layers align.
export function infillLines(region, angleDeg, spacing) {
  if (!region.length) return []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of region) for (const q of p) {
    if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X
    if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y
  }
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx
  const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
  const ns = corners.map((c) => c[0] * nx + c[1] * ny), ds = corners.map((c) => c[0] * dx + c[1] * dy)
  const nMin = Math.min(...ns), nMax = Math.max(...ns), dMin = Math.min(...ds) - 1000, dMax = Math.max(...ds) + 1000
  const step = spacing * SCALE
  const lines = []
  for (let n = Math.ceil(nMin / step) * step; n <= nMax; n += step) {
    lines.push([
      { X: Math.round(n * nx + dMin * dx), Y: Math.round(n * ny + dMin * dy) },
      { X: Math.round(n * nx + dMax * dx), Y: Math.round(n * ny + dMax * dy) },
    ])
  }
  const clipped = clipLines(lines, region)
  const key = (p) => p[0].X * nx + p[0].Y * ny
  clipped.sort((p, q) => key(p) - key(q))
  return clipped
}

// Yield to the event loop without setTimeout, which is throttled in background tabs.
const chan = typeof MessageChannel !== "undefined" ? new MessageChannel() : null
const tick = () => new Promise((r) => {
  if (!chan) return setTimeout(r, 0)
  chan.port1.onmessage = () => r()
  chan.port2.postMessage(0)
})

// Where a model goes on the bed: centred in X/Y, resting on Z = 0.
export function bedOffset(b, s) {
  return [s.bedX / 2 - (b.min[0] + b.max[0]) / 2, s.bedY / 2 - (b.min[1] + b.max[1]) / 2, -b.min[2]]
}

// Returns { layers: [{z, top, h, walls:[[ring paths]], solid:[lines], sparse:[lines]}], size }
export async function buildToolpaths(trisIn, s, onProgress = () => {}) {
  const b = bounds(trisIn)
  const [dx, dy, dz] = bedOffset(b, s)
  const tris = new Float32Array(trisIn.length)
  for (let i = 0; i < tris.length; i += 3) { tris[i] = trisIn[i] + dx; tris[i + 1] = trisIn[i + 1] + dy; tris[i + 2] = trisIn[i + 2] + dz }
  const size = b.max.map((v, i) => v - b.min[i])
  if (size[0] > s.bedX || size[1] > s.bedY || size[2] > s.bedZ) {
    throw new Error(`Model is ${size.map((v) => v.toFixed(1)).join(" × ")} mm — larger than the ${s.bedX}×${s.bedY}×${s.bedZ} mm build volume. Check its units, or lower Scale.`)
  }
  if (!(size[2] > 0)) throw new Error("Model is flat: it has no height to slice")
  const sliced = sliceMesh(tris, s.layerHeight, s.firstLayerHeight, 0, size[2])
  const w = s.lineWidth, n = sliced.length
  const region = sliced.map((l) => C.Clipper.SimplifyPolygons(l.loops, PT.pftEvenOdd))
  const inner = region.map((r) => offset(r, -s.wallLoops * w))
  await tick()
  const layers = []
  let prevTop = 0
  for (let i = 0; i < n; i++) {
    const L = sliced[i]
    const rings = []
    for (let k = 0; k < s.wallLoops; k++) {
      const ring = offset(region[i], -(k + 0.5) * w)
      if (ring.length) rings.push(ring)
    }
    const infillRegion = offset(region[i], -(s.wallLoops - 0.15) * w)
    let sparseRegion = inner[i]
    for (let j = i + 1; j <= i + s.topLayers && sparseRegion.length; j++) sparseRegion = j < n ? boolean(CT.ctIntersection, sparseRegion, inner[j]) : []
    for (let j = i - 1; j >= i - s.bottomLayers && sparseRegion.length; j--) sparseRegion = j >= 0 ? boolean(CT.ctIntersection, sparseRegion, inner[j]) : []
    const solidRegion = s.infillDensity >= 100 ? infillRegion : boolean(CT.ctDifference, infillRegion, offset(sparseRegion, 0.15 * w))
    const diag = i % 2 ? 135 : 45
    const solid = infillLines(solidRegion, diag, w)
    let sparse = []
    if (s.infillDensity > 0 && s.infillDensity < 100 && sparseRegion.length) {
      sparse = infillLines(boolean(CT.ctIntersection, offset(sparseRegion, 0.15 * w), infillRegion), diag, (w * 100) / s.infillDensity)
    }
    layers.push({ z: L.top, h: L.top - prevTop, rings, solid, sparse })
    prevTop = L.top
    if (i % 5 === 0) { onProgress((i + 1) / n); await tick() }
  }
  return { layers, size }
}

// The wave profile along the hull: the height of the water where it meets
// the hull, along its length. Pure.
//
// A free-surface run keeps the water surface (the α = 0.5 iso-surface) as a
// mesh. Where it meets the hull it stops, so the contact line is that mesh's
// boundary along the hull. The domain's own edges (inlet, outlet, sides, the
// symmetry plane ahead of the stem and behind the transom) are far from the
// hull's length or outside it: within the hull's length, the only boundary
// the surface has is the hull. Each side (port, starboard) is averaged into
// stations along the length; a half model has one side, standing for both.

/**
 * @param {{ positions: Float32Array, indices: Uint32Array, half?: boolean }} surface  the free-surface layer (analysis frame, metres)
 * @param {{ xMin: number, xMax: number }} hull   the hull's length in the same frame
 * @param {{ stations?: number }} [o]  stations: how many along the length; by default about one for
 *   every six contact edges a side (between 20 and 160), so each averages several and a coarse
 *   mesh's zig-zag along its cells doesn't show as spikes
 * @returns {{ side: "port"|"starboard"|"both", points: number[][] }[]}  points: [x, z], stern to bow
 */
export function waveProfile(surface, hull, { stations = null } = {}) {
  const P = surface.positions;
  const I = surface.indices;
  // boundary edges: used by one triangle
  const count = new Map();
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const k = key(I[t + e], I[t + ((e + 1) % 3)]);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  const L = hull.xMax - hull.xMin;
  const lo = hull.xMin - 0.005 * L;
  const hi = hull.xMax + 0.005 * L;
  const bins = { port: new Map(), starboard: new Map() };
  // the contact edges first, so the station count can follow how many there are
  const edges = [];
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const a = Math.floor(k / 4294967296), b = k % 4294967296;
    const x = (P[a * 3] + P[b * 3]) / 2;
    if (x < lo || x > hi) continue;
    edges.push([x, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2]);
  }
  const perSide = edges.length / (surface.half ? 1 : 2);
  const n = stations ?? Math.max(20, Math.min(160, Math.round(perSide / 6)));
  const add = (side, x, z) => {
    const b = Math.min(n - 1, Math.max(0, Math.floor(((x - lo) / (hi - lo)) * n)));
    const s = bins[side].get(b) ?? { x: 0, z: 0, k: 0 };
    s.x += x;
    s.z += z;
    s.k++;
    bins[side].set(b, s);
  };
  for (const [x, y, z] of edges) add(y > 0 ? "port" : "starboard", x, z);
  const out = [];
  for (const side of ["starboard", "port"]) {
    const pts = [...bins[side].entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, s]) => [s.x / s.k, s.z / s.k]);
    if (pts.length >= 2) out.push({ side: surface.half ? "both" : side, points: pts });
  }
  return out;
}

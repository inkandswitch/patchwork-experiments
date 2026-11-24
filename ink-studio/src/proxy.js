// A blocky stand-in for an ink world, as a mesh: the splats' centres
// voxelized on a grid, each filled cell's open faces drawn in the average
// colour of its splats. The scene uses it to pick, bound and frame the object
// (and shows it where ink's own drawing isn't running); the in-scene layer
// hides it and draws the splats themselves.
//
// Pure: world in, arrays out. Units are the world's (one ink unit, one metre).

const STRIDE = 16;

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** [lo, hi] holding all but `cut` of the values at each end. */
function spread(values, cut) {
  const sorted = Float32Array.from(values).sort();
  const k = Math.floor(sorted.length * cut);
  return [sorted[k], sorted[sorted.length - 1 - k]];
}

// the six faces of a unit cell: direction, then its four corners (counter-clockwise from outside)
const FACES = [
  [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
];

/**
 * @param {{ data: Float32Array, count: number }} world
 * @param {{ cells?: number, minDensity?: number, cut?: number }} [o]
 *   cells across the longest side; splats fainter than minDensity are left
 *   out; `cut` of the splats at each end of each axis are outliers (a far sky).
 * @returns {{ positions: Float32Array, normals: Float32Array, colors: Float32Array,
 *   indices: Uint32Array, bounds: { min: number[], max: number[] } | null, cells: number }}
 */
export function proxyMesh(world, { cells = 48, minDensity = 0.02, cut = 0.002 } = {}) {
  const { data, count } = world;
  const keep = [];
  for (let i = 0; i < count; i++) if (data[i * STRIDE + 3] > minDensity) keep.push(i);
  const empty = { positions: new Float32Array(0), normals: new Float32Array(0), colors: new Float32Array(0), indices: new Uint32Array(0), bounds: null, cells: 0 };
  if (!keep.length) return empty;

  const range = [0, 1, 2].map((axis) => spread(keep.map((i) => data[i * STRIDE + axis]), cut));
  const size = Math.max(...range.map(([lo, hi]) => hi - lo), 1e-6);
  const h = size / cells;
  const dims = range.map(([lo, hi]) => Math.max(1, Math.ceil((hi - lo) / h + 1e-9)));
  const key = (x, y, z) => x + dims[0] * (y + dims[1] * z);

  // each cell: summed linear colour and count
  const sums = new Map();
  for (const i of keep) {
    const o = i * STRIDE;
    const c = [0, 1, 2].map((a) => Math.floor((data[o + a] - range[a][0]) / h));
    if (c.some((v, a) => v < 0 || v >= dims[a])) continue;
    const k = key(c[0], c[1], c[2]);
    let s = sums.get(k);
    if (!s) sums.set(k, (s = [0, 0, 0, 0, c[0], c[1], c[2]]));
    const packed = data[o + 7];
    s[0] += srgbToLinear(packed % 256);
    s[1] += srgbToLinear(Math.floor(packed / 256) % 256);
    s[2] += srgbToLinear(Math.floor(packed / 65536) % 256);
    s[3]++;
  }

  const positions = [], normals = [], colors = [], indices = [];
  for (const s of sums.values()) {
    const [r, g, b, n, x, y, z] = s;
    for (const [dir, corners] of FACES) {
      const nx = x + dir[0], ny = y + dir[1], nz = z + dir[2];
      const inside = nx >= 0 && ny >= 0 && nz >= 0 && nx < dims[0] && ny < dims[1] && nz < dims[2];
      if (inside && sums.has(key(nx, ny, nz))) continue;
      const base = positions.length / 3;
      for (const [cx, cy, cz] of corners) {
        positions.push(range[0][0] + (x + cx) * h, range[1][0] + (y + cy) * h, range[2][0] + (z + cz) * h);
        normals.push(...dir);
        colors.push(r / n, g / n, b / n);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const min = range.map(([lo]) => lo), max = range.map(([lo], a) => lo + dims[a] * h);
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    colors: Float32Array.from(colors),
    indices: Uint32Array.from(indices),
    bounds: { min, max },
    cells: sums.size,
  };
}

/**
 * Where a world's splats are: the centre and radius of the box holding all
 * but `cut` of them at each end of each axis (a far sky left out), in its own
 * units. The in-scene layer frames ink's depth window with it.
 * @returns {{ centre: number[], radius: number } | null}
 */
export function worldBounds(world, { minDensity = 0.02, cut = 0.002 } = {}) {
  const { data, count } = world;
  const keep = [];
  for (let i = 0; i < count; i++) if (data[i * STRIDE + 3] > minDensity) keep.push(i);
  if (!keep.length) return null;
  const range = [0, 1, 2].map((axis) => spread(keep.map((i) => data[i * STRIDE + axis]), cut));
  const centre = range.map(([lo, hi]) => (lo + hi) / 2);
  const radius = Math.max(1e-3, Math.hypot(...range.map(([lo, hi]) => (hi - lo) / 2)));
  return { centre, radius };
}

const palette = [
  0x101925, 0x192839, 0x26384c, 0x3f5365, 0x637b86, 0xabbdbb,
  0x173737, 0x22615f, 0x3c8d83, 0x6eb3a2, 0x9fd2b8, 0xe0e1af,
  0x51363d, 0x87544d, 0xb77b59, 0xdfa678, 0xf1ca91, 0xffe4b4
];
const tileCenter = [-1.28, 0], tileRadius = .86;
const cube = { position: [1.26, 0, .02], rotation: [.26, -.38, -.14], scale: .65 };
const tileHalfWidth = tileRadius * Math.cos(Math.PI / 10);
const bounds = { min: [tileCenter[0] - tileHalfWidth, -tileRadius, .044],
  max: [tileCenter[0] + tileHalfWidth, tileRadius, .050] };

function surface(SpriteSurface, draw) {
  const points = [], triangles = [], slots = [];
  function polygon(vertices, color) {
    const first = points.length / 3;
    for (const p of vertices) {
      points.push(...p);
      slots.push(color);
    }
    for (let i = 1; i + 1 < vertices.length; i++) triangles.push(first, first + i, first + i + 1);
  }
  draw(polygon);
  const uvs = new Float32Array(slots.length * 2);
  for (let i = 0; i < slots.length; i++) uvs[2 * i] = slots[i] / (palette.length - 1);
  const atlas = SpriteSurface.make(32);
  atlas.mesh({ points, triangles, uvs }, palette.length, 1, i => palette[i]);
  return atlas.finish();
}

function mosaic(K, SpriteSurface, layout) {
  return surface(SpriteSurface, polygon => {
    for (const tile of layout.tiles) {
      const center = tile.polygon.reduce(([x, y], p) => [x + p[0] / tile.polygon.length, y + p[1] / tile.polygon.length], [0, 0]);
      const angle = Math.atan2(center[1], center[0] - tileCenter[0]), sector = Math.cos(angle * 5 - .7);
      const lineage = tile.addresses[0].reduce((key, component) => key * 9 + component + 1, 13);
      const warm = sector > -.05, thin = tile.type.toLowerCase().includes('thin');
      const fill = (warm ? 13 : 7) + (thin ? 1 : 2) + Number(K.hash(lineage, 42) > .7);
      polygon(tile.polygon.map(([x, y]) => [x, y, .044]), warm ? 12 : 6);
      polygon(tile.polygon.map(([x, y]) => [x + (center[0] - x) * .086, y + (center[1] - y) * .086, .050]), fill);
    }
  });
}

function carved(K, SpriteSurface, form, n) {
  const T = K.procedural.transforms, pose = T.local(cube), V = K.V, pitch = 2 / n;
  const index = (x, y, z) => x + n * (y + n * z), cells = new Uint8Array(n ** 3);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const point = T.point(pose, [x, y, z].map(k => (k + .5) * pitch - 1));
    cells[index(x, y, z)] = Number(form.sd(...point) < 0);
  }
  const light = V.norm([-.57, .55, .76]);
  return surface(SpriteSurface, polygon => {
    const sides = [0, 1, 2].flatMap(axis => [-1, 1].map(sign => {
      const direction = [0, 0, 0]; direction[axis] = sign;
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const shade = Math.max(0, V.dot(light, T.normal(pose, direction)));
      return { axis, sign, u, v, shade };
    }));
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!cells[index(x, y, z)]) continue;
      const at = [x, y, z], origin = at.map(k => k * pitch - 1);
      for (const { axis, sign, u, v, shade } of sides) {
        const next = at.slice(); next[axis] += sign;
        if (next[axis] >= 0 && next[axis] < n && cells[index(...next)]) continue;
        const points = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => {
          const p = origin.slice();
          p[axis] += sign > 0 ? pitch : 0; p[u] += s * pitch; p[v] += t * pitch;
          return T.point(pose, p);
        });
        const lit = Math.min(5, Math.floor(shade * 6));
        polygon(points, 12 + lit);
      }
    }
  });
}

module.exports = ({ KIT: K, makeBuilder, SpriteSurface }) => ({
  id: 'scale-aware-previews', name: 'Fractal and Tiling at Three Scales', seed: 42,
  build(seed) {
    const A = K.procedural.lod.preview, b = makeBuilder(seed, palette);
    const tiling = A.tiling({ id: 'penrose', family: 'penrose', depth: 5, center: tileCenter, radius: tileRadius,
      bounds, basis: [[1, 0, 0], [0, 1, 0]], minPixels: 2.8, maxWork: 1500,
      build: layout => mosaic(K, SpriteSurface, layout) });
    const menger = A.menger({ id: 'menger', pose: cube, iterations: 3, minPixels: 2.2, maxWork: 65000,
      build: (form, tier) => carved(K, SpriteSurface, form, tier.samplesPerAxis) });
    return b.finish({ scalePreviews: [tiling, menger], cam: { target: [0, 0, 0], dist: 8.8, fov: .55, yaw: 0, pitch: 0, sway: 0 },
      detail: 22, radius: 6, dither: 0, look: { pixelSize: 1 } });
  }
});

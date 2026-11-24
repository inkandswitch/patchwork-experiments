// A headless coastline with a continuous walk, dive, and surfacing route.
module.exports = function coast(K, snapshot) {
  const { biomeRecipes, biomeWorld, waterBodies } = K.procedural;
  const height = x => x < -4 ? 0.55 + (-4 - x) * 0.18 : x < -1 ? 0.55 - (x + 4) * 0.57 :
    -1.16 + Math.max(0, Math.min(1, (x - 0.7) / 2.4)) * 2.65;
  function cavity(min, max) {
    return { bounds: { min, max }, sdf(x, y, z) {
      const q = [x, y, z].map((v, i) => Math.max(min[i] - v, v - max[i]));
      return Math.hypot(...q.map(v => Math.max(0, v))) + Math.min(0, Math.max(...q));
    } };
  }
  const caves = [
    cavity([-0.65, -4.25, -1.35], [7.6, -0.35, 1.35]),
    cavity([6, -4.25, -1.6], [10.5, 1, 1.6])
  ];
  const pocket = { id: 'chamber-air', bounds: { min: [7.7, -1.62, -1.22], max: [10.3, 0.83, 1.22] } };
  function water(level = 0) {
    return waterBodies.scene([waterBodies.create({
      id: 'coast-water', bounds: { min: [-4, -2], max: [12, 2] }, resolution: [32, 8],
      sample(x, z) {
        const bed = x >= -0.65 && x < 10.5 && Math.abs(z) < 1.6 ? -4.25 : height(x);
        return { bed, surface: level, current: [0.21, 0] };
      },
      optics: { extinction: [0.42, 0.24, 0.14], tint: [0.03, 0.16, 0.23],
        surface: 0, refraction: 0, foam: 0, caustics: 0 }
    })], { airPockets: [pocket] });
  }
  function layered(level = 0.38, view = author.view()) {
    const base = compiler.prepare(view);
    const air = cavity(pocket.bounds.min, pocket.bounds.max);
    const sea = cavity([-9, -5.2, -2], [12, level, 2]);
    const volumes = [
      { id: pocket.id, kind: 'air', field: air.sdf, priority: 1 },
      { id: 'coast-water', kind: 'water', field: sea.sdf, current: [0.21, 0, 0] }
    ];
    const tiles = Array.from({ length: 7 }, (_, i) => base.bakeSpans({
      bounds: { min: [-16 + i * 4, -5.2, -2], max: [-12 + i * 4, 4, 2] },
      resolution: [8, 8], volumes, step: 0.2
    }));
    const grid = K.procedural.verticalSpans.create({
      bounds: { min: [-16, -5.2, -2], max: [12, 4, 2] }, resolution: [56, 8],
      sample: (x, z, i, j) => tiles[Math.floor(i / 8)].column(i % 8, j)
    });
    const scene = waterBodies.scene([waterBodies.fromSpans(grid, { id: 'coast',
      optics: { extinction: [0.42, 0.24, 0.14], tint: [0.03, 0.16, 0.23],
        surface: 0, refraction: 0, foam: 0, caustics: 0 }
    })]);
    return { frame: compiler.prepare(view, { water: scene }), tiles, grid };
  }
  const author = biomeRecipes.create({
    snapshot, seed: 63, fallback: 'ridge',
    conditions(x, y) { return { moisture: x < -5 ? 0.2 : 0.82, clarity: x < 4.2 ? 0.9 : 0.25, light: y < -1.8 ? 0.13 : 0.82 }; },
    regions: [
      { id: 'ridge', biome: 'ridge', bounds: { min: [-16, 0, -2], max: [-4, 4, 2] } },
      { id: 'marsh', biome: 'marsh', bounds: { min: [-5, -2, -1.9], max: [-0.65, 1.4, 1.9] } },
      { id: 'reef', biome: 'reef', bounds: { min: [-0.65, -4.25, -1.4], max: [4.2, 0.5, 1.4] } },
      { id: 'passage', biome: 'cave', bounds: { min: [-0.65, -4.25, -1.35], max: [10.5, 1, 1.35] } }
    ],
    recipes: [
      { id: 'ridge', landform: { kind: 'ridge', height: 0 },
        materials: { scree: [0x364251, 0x687988, 0xd2c4a0] },
        populations: [{ id: 'lichen', habitat: { media: ['air'], ranges: { elevation: { min: 0.7 } } }, density: 0.85 }],
        landmarks: [{ id: 'marker', at: [0.26, 0.45, 0.65], asset: 'stone-marker' }],
        routes: [{ id: 'ridge-path', points: [[0.07, 0.4, 0.64], [0.93, 0.25, 0.64]], clearance: 0.24 }],
        ambient: [{ id: 'wind' }], traversal: ['walk'] },
      { id: 'marsh', landform: { kind: 'tidal-flat', height: -0.05 },
        materials: { mud: [0x352e24, 0x6d6441, 0xa49963] },
        habitat: { ranges: { moisture: { min: 0.7 } } },
        populations: [{ id: 'reed', habitat: { media: ['air'], ranges: { moisture: { min: 0.7 } } }, density: 0.86 }],
        traversal: ['walk', 'wade'] },
      { id: 'reef', landform: { kind: 'shelf', height: 0 },
        habitat: { media: ['water'] }, materials: { rock: [0x323a30, 0x747756, 0xb1a67a] },
        populations: [{ id: 'kelp', density: 0.98, habitat: { media: ['water'], ranges: { clarity: { min: 0.75 }, depth: { min: 1 } } } }],
        traversal: ['swim'] },
      { id: 'cave', landform: { kind: 'chamber', height: 0 },
        materials: { stone: [0x373d49, 0x767d73, 0xb6ae90], strata: [0x252f40, 0x46535b, 0x69797c] },
        strata: { fallback: 'stone', layers: [{ min: -9, max: -1.2, material: 'strata' }] },
        populations: [{ id: 'glow-moss', density: 0.77, habitat: { ranges: { light: { max: 0.2 } } } }],
        landmarks: [{ id: 'seal', at: [0.89, 0.67, 0.7], asset: 'chamber-seal' }],
        routes: [{ id: 'dive', points: [[0.03, 0.66, 0.7], [0.09, 0.31, 0.7], [0.62, 0.31, 0.7],
          [0.81, 0.32, 0.7], [0.87, 0.68, 0.7]], clearance: 0.32 }],
        ambient: [{ id: 'drips' }], traversal: ['swim', 'low-light'] }
    ]
  });
  const compiler = biomeWorld.create({
    height, caves, cell: 0.4, chunkCells: 10, verticalCells: [-13, 10], terrainSlope: 1.15,
    palette: [0x111d28, 0x4f6170, 0x69797c, 0xaa9769, 0xc4d8a0, 0xf1d598],
    layers: [
      { id: 'ground', habitatOffset: 0.12, options: { spacing: 0.68, slots: 3, exclusion: { distance: 0.38 } } },
      { id: 'cave-floor', habitatOffset: 0.68, options: { spacing: 0.68, slots: 3, exclusion: { distance: 0.42 } },
        height: (x, z, frame) => frame.supports(x, z, -4.27, -4.23).find(row => row.id === 'cave')?.y ?? null }
    ],
    project(point, feature, terrain) {
      return feature.region === 'ridge' ? [point[0], terrain.heightAt(point[0], point[2]), point[2]] : point;
    },
    emit(B, item) {
      const [x, y, z] = item.point;
      if (item.kind === 'landmark') {
        for (let i = 0; i < 4; i++)
          B.disc(x, y + i * 0.11, z, [1, 0, 0], 0.19 - i * 0.016, 0.065, B.P[i === 3 ? 5 : 3], 1);
        return;
      }
      const color = item.species === 'kelp' ? [72, 140, 103] :
        item.species === 'reed' ? [152, 152, 90] : item.species === 'glow-moss' ? [96, 202, 188] : [171, 176, 143];
      const tall = item.species === 'reed' || item.species === 'kelp';
      for (let i = 0; i < (tall ? 4 : 1); i++)
        B.disc(x + i * 0.04, y + (i + 0.5) * (tall ? 0.2 : 0.03) * item.scale, z,
          tall ? [0, 0, 1] : [0, 1, 0], 0.07 * item.scale, 0.035, color, 1);
    }
  });
  const indices = Array.from({ length: 7 }, (_, i) => [i - 4, 0]).concat(
    Array.from({ length: 7 }, (_, i) => [i - 4, -1]));
  function itinerary(frame) {
    const z = 0.54, steps = Array.from({ length: 26 }, (_, i) => {
      const x = -14 + i * 0.49;
      return [x, frame.heightAt(x, z) + 0.45, z];
    });
    return steps.concat(frame.view.layout.routes.find(route => route.region === 'passage' && route.id === 'dive').points);
  }
  return { author, compiler, water, layered, indices, itinerary };
};
